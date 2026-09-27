// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchIndexHost, type PortLike } from "./host";
import type { IndexTarget, TabMessage, WorkerMessage } from "./protocol";
import { MemoryIndexStore } from "./store";
import { FakeServer, issueRecord } from "./testing";

const target: IndexTarget = { userId: "user", workspaceId: "ws", workspaceSlug: "acme" };

/** A tab that answers the worker's fetch requests from a fake server. */
class FakeTab implements PortLike {
  received: WorkerMessage[] = [];
  send!: (message: TabMessage) => void;
  answer = true;
  failWith: number | null = null;

  constructor(private readonly server: FakeServer) {}

  postMessage(message: WorkerMessage): void {
    this.received.push(message);
    if (message.type !== "fetch" || !this.answer) return;
    const { op, params } = message;
    void (async () => {
      if (this.failWith !== null) {
        this.send({ type: "fetch-result", id: message.id, ok: false, status: this.failWith, message: "denied" });
        return;
      }
      const data =
        op === "manifest"
          ? await this.server.manifest()
          : op === "snapshot"
            ? await this.server.snapshot(params.afterNumber ?? 0, params.limit ?? 200)
            : await this.server.changes(params.cursor ?? "");
      this.send({ type: "fetch-result", id: message.id, ok: true, data });
    })();
  }

  last<T extends WorkerMessage["type"]>(type: T): Extract<WorkerMessage, { type: T }> | undefined {
    return this.received.filter((m) => m.type === type).at(-1) as Extract<WorkerMessage, { type: T }> | undefined;
  }
}

function setup(server: FakeServer, options: { releaseDelayMs?: number; now?: () => number } = {}) {
  const stores = new Map<string, MemoryIndexStore>();
  const wipeAll = vi.fn(async () => undefined);
  const host = new SearchIndexHost({
    createStore: (t) => {
      const store = stores.get(t.workspaceId) ?? new MemoryIndexStore();
      stores.set(t.workspaceId, store);
      return store;
    },
    wipeAll,
    indexOptions: { syncDebounceMs: 0, pollIntervalMs: 60 * 60 * 1000, retryBaseMs: 60 * 60 * 1000 },
    releaseDelayMs: options.releaseDelayMs ?? 60_000,
    fetchTimeoutMs: 50,
    now: options.now,
  });
  const connect = () => {
    const tab = new FakeTab(server);
    tab.send = host.connect(tab);
    return tab;
  };
  return { host, stores, wipeAll, connect };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 1));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchIndexHost", () => {
  it("syncs through an attached tab and answers its searches", async () => {
    const server = new FakeServer();
    server.apply({ kind: "issue", record: issueRecord(1, "Hosted issue") });
    const { connect } = setup(server);
    const tab = connect();

    expect(tab.received[0]).toEqual({ type: "hello" });
    tab.send({ type: "attach", target });
    await settle();

    expect(tab.received.filter((m) => m.type === "fetch").every((m) => m.type === "fetch" && m.workspaceSlug === "acme")).toBe(true);
    expect(tab.last("serving")).toEqual({ type: "serving", key: "user:ws", serving: true });

    tab.send({ type: "search", id: 7, kind: "issues", params: { q: "hosted" } });
    await settle();
    const result = tab.last("search-result");
    expect(result?.id).toBe(7);
    expect(result?.result && "issues" in result.result ? result.result.issues.map((i) => i.id) : null).toEqual(["issue-1"]);
  });

  it("asks another tab when the one it asked goes silent", async () => {
    const server = new FakeServer();
    server.apply({ kind: "issue", record: issueRecord(1, "Failover issue") });
    let now = 1_000;
    const { connect } = setup(server, { now: () => now });
    const silent = connect();
    silent.answer = false;
    const live = connect();
    live.send({ type: "attach", target });
    now += 1;
    // The silent tab was active most recently, so it is asked first.
    silent.send({ type: "attach", target });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await settle();

    expect(silent.received.some((m) => m.type === "fetch")).toBe(true);
    expect(live.last("serving")?.serving).toBe(true);
  });

  it("does not retry a request the server rejected", async () => {
    const server = new FakeServer();
    const { connect } = setup(server);
    const first = connect();
    first.failWith = 404;
    const second = connect();
    first.send({ type: "attach", target });
    second.send({ type: "attach", target });
    await settle();

    // Both tabs would answer, but a server rejection must not fall through to
    // the other tab.
    const asked = [first, second].filter((tab) => tab.received.some((m) => m.type === "fetch"));
    expect(asked).toHaveLength(1);
  });

  it("frees an index a while after its last tab leaves", async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    server.apply({ kind: "issue", record: issueRecord(1, "Released") });
    const { connect } = setup(server, { releaseDelayMs: 1_000 });
    const tab = connect();
    tab.send({ type: "attach", target });
    await vi.advanceTimersByTimeAsync(10);
    expect(tab.last("serving")?.serving).toBe(true);

    tab.send({ type: "detach" });
    await vi.advanceTimersByTimeAsync(2_000);
    tab.send({ type: "attach", target });
    // A fresh index reloads from the store before it can serve again.
    expect(tab.last("serving")?.serving).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(tab.last("serving")?.serving).toBe(true);
  });

  it("wipes every index on request", async () => {
    const server = new FakeServer();
    server.apply({ kind: "issue", record: issueRecord(1, "Secret") });
    const { connect, stores, wipeAll } = setup(server);
    const tab = connect();
    tab.send({ type: "attach", target });
    await settle();

    tab.send({ type: "wipe", id: 3 });
    await settle();
    expect(tab.last("wiped")).toEqual({ type: "wiped", id: 3 });
    expect(stores.get("ws")?.destroyed).toBe(true);
    expect(wipeAll).toHaveBeenCalled();

    tab.send({ type: "search", id: 4, kind: "issues", params: { q: "secret" } });
    await settle();
    expect(tab.last("search-result")?.result).toBeNull();
  });
});
