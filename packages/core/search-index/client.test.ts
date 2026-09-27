// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { LocalSearchIndexClient, type SearchIndexApi, type WorkerChannel } from "./client";
import type { TabMessage, WorkerMessage } from "./protocol";

const target = { userId: "user", workspaceId: "ws", workspaceSlug: "acme" };

function fakeChannel() {
  const posted: TabMessage[] = [];
  let deliver: (message: WorkerMessage) => void = () => undefined;
  let fail: () => void = () => undefined;
  const channel: WorkerChannel = {
    post: (message) => posted.push(message),
    onMessage: (handler) => {
      deliver = handler;
    },
    onError: (handler) => {
      fail = handler;
    },
  };
  return { channel, posted, deliver: (m: WorkerMessage) => deliver(m), fail: () => fail() };
}

function fakeApi(): SearchIndexApi {
  return {
    getSearchIndexManifest: vi.fn(async () => ({
      cursor: "c1",
      issue_count: 0,
      comment_count: 0,
      project_count: 0,
      text_bytes: 0,
    })),
    getSearchIndexSnapshot: vi.fn(),
    getSearchIndexChanges: vi.fn(async () => {
      throw new ApiError("workspace not found", 404, "Not Found");
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LocalSearchIndexClient", () => {
  it("answers null everywhere when no worker can start", async () => {
    const client = new LocalSearchIndexClient(fakeApi, () => null);
    client.attach(target);
    expect(client.isServing()).toBe(false);
    expect(await client.searchIssues({ q: "anything" })).toBeNull();
    await expect(client.wipe()).resolves.toBeUndefined();
  });

  it("searches locally only once the worker reports the workspace is serving", async () => {
    const worker = fakeChannel();
    const client = new LocalSearchIndexClient(fakeApi, () => worker.channel);
    client.attach(target);
    expect(worker.posted[0]).toEqual({ type: "attach", target });
    expect(await client.searchIssues({ q: "early" })).toBeNull();

    worker.deliver({ type: "hello" });
    worker.deliver({ type: "serving", key: "user:ws", serving: true });
    expect(client.isServing()).toBe(true);

    const pending = client.searchIssues({ q: "needle", limit: 5, include_closed: true });
    const request = worker.posted.at(-1);
    expect(request).toMatchObject({ type: "search", kind: "issues", params: { q: "needle", limit: 5, include_closed: true } });
    worker.deliver({ type: "search-result", id: (request as { id: number }).id, result: { issues: [] } });
    expect(await pending).toEqual({ issues: [] });
  });

  it("gives up on a slow search so the caller can ask the server", async () => {
    vi.useFakeTimers();
    const worker = fakeChannel();
    const client = new LocalSearchIndexClient(fakeApi, () => worker.channel);
    client.attach(target);
    worker.deliver({ type: "hello" });
    worker.deliver({ type: "serving", key: "user:ws", serving: true });

    const pending = client.searchIssues({ q: "slow" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
  });

  it("ignores serving updates for another workspace and resets on retarget", () => {
    const worker = fakeChannel();
    const client = new LocalSearchIndexClient(fakeApi, () => worker.channel);
    client.attach(target);
    worker.deliver({ type: "hello" });
    worker.deliver({ type: "serving", key: "user:other", serving: true });
    expect(client.isServing()).toBe(false);

    worker.deliver({ type: "serving", key: "user:ws", serving: true });
    client.attach({ ...target, workspaceId: "ws2", workspaceSlug: "beta" });
    expect(client.isServing()).toBe(false);
  });

  it("runs the worker's requests through the API with the workspace slug", async () => {
    const api = fakeApi();
    const worker = fakeChannel();
    const client = new LocalSearchIndexClient(() => api, () => worker.channel);
    client.attach(target);

    worker.deliver({ type: "fetch", id: 1, op: "manifest", workspaceSlug: "acme", params: {} });
    worker.deliver({ type: "fetch", id: 2, op: "changes", workspaceSlug: "acme", params: { cursor: "c1", limit: 10 } });
    await vi.waitFor(() => expect(worker.posted.filter((m) => m.type === "fetch-result")).toHaveLength(2));

    expect(api.getSearchIndexManifest).toHaveBeenCalledWith({ workspaceSlug: "acme" });
    expect(api.getSearchIndexChanges).toHaveBeenCalledWith({ workspaceSlug: "acme", cursor: "c1", limit: 10 });
    const results = worker.posted.filter((m) => m.type === "fetch-result");
    expect(results).toContainEqual(expect.objectContaining({ id: 1, ok: true }));
    expect(results).toContainEqual(expect.objectContaining({ id: 2, ok: false, status: 404 }));
  });

  it("stops using a worker that failed", async () => {
    const worker = fakeChannel();
    const client = new LocalSearchIndexClient(fakeApi, () => worker.channel);
    client.attach(target);
    worker.deliver({ type: "hello" });
    worker.deliver({ type: "serving", key: "user:ws", serving: true });

    worker.fail();
    expect(client.isServing()).toBe(false);
    expect(await client.searchIssues({ q: "after failure" })).toBeNull();
  });
});
