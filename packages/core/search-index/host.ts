import type { SearchIndexChanges, SearchIndexManifest, SearchIndexSnapshotPage } from "../types";
import { indexTargetKey, type FetchOp, type IndexTarget, type TabMessage, type WorkerMessage } from "./protocol";
import type { IndexStore } from "./store";
import { IndexFetchError, WorkspaceIndex, type IndexFetcher, type WorkspaceIndexOptions } from "./sync";

/**
 * Runs inside the search index worker (MUL-7754). A SharedWorker hosts every
 * tab of the origin; a dedicated worker hosts one. Tabs attach to the
 * workspace they show, and the host keeps one WorkspaceIndex per attached
 * (user, workspace), released a minute after its last tab leaves.
 *
 * The worker has no credentials: it asks an attached tab to run each request
 * through the tab's API client, so authentication, session renewal, and
 * workspace headers stay where they already work.
 */

export interface PortLike {
  postMessage(message: WorkerMessage): void;
}

export interface SearchIndexHostDeps {
  createStore(target: IndexTarget): IndexStore;
  /** Deletes every stored index on this origin. */
  wipeAll(): Promise<void>;
  indexOptions?: Partial<WorkspaceIndexOptions>;
  /** Wait before freeing an index no tab is attached to. */
  releaseDelayMs?: number;
  /** How long a tab has to answer a request before another tab is asked. */
  fetchTimeoutMs?: number;
  /** A tab silent for this long is treated as closed. */
  portTimeoutMs?: number;
  now?: () => number;
}

interface PortEntry {
  port: PortLike;
  target: IndexTarget | null;
  lastSeen: number;
}

interface IndexEntry {
  index: WorkspaceIndex;
  slug: string;
  ports: Set<PortEntry>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

interface PendingFetch {
  entry: PortEntry;
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class PortGoneError extends Error {}

export class SearchIndexHost {
  private readonly ports = new Map<PortLike, PortEntry>();
  private readonly indexes = new Map<string, IndexEntry>();
  private readonly pending = new Map<number, PendingFetch>();
  private nextFetchId = 1;
  private readonly releaseDelayMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly portTimeoutMs: number;
  private readonly now: () => number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SearchIndexHostDeps) {
    this.releaseDelayMs = deps.releaseDelayMs ?? 60_000;
    this.fetchTimeoutMs = deps.fetchTimeoutMs ?? 60_000;
    this.portTimeoutMs = deps.portTimeoutMs ?? 10 * 60_000;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Registers a tab's port and returns the handler for its messages. */
  connect(port: PortLike): (message: TabMessage) => void {
    const entry: PortEntry = { port, target: null, lastSeen: this.now() };
    this.ports.set(port, entry);
    this.sweepTimer ??= setInterval(() => this.sweep(), Math.min(this.portTimeoutMs, 60_000));
    port.postMessage({ type: "hello" });
    return (message) => this.handle(entry, message);
  }

  disconnect(port: PortLike): void {
    const entry = this.ports.get(port);
    if (!entry) return;
    this.ports.delete(port);
    this.detach(entry);
    for (const [id, pending] of this.pending) {
      if (pending.entry === entry) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new PortGoneError("tab closed"));
      }
    }
  }

  private handle(entry: PortEntry, message: TabMessage): void {
    entry.lastSeen = this.now();
    switch (message.type) {
      case "attach":
        this.attach(entry, message.target);
        return;
      case "detach":
        this.detach(entry);
        return;
      case "close":
        this.disconnect(entry.port);
        return;
      case "poke":
        if (entry.target) this.indexes.get(indexTargetKey(entry.target))?.index.requestSync();
        return;
      case "ping":
        return;
      case "search":
        void this.search(entry, message.id, message.kind, message.params);
        return;
      case "fetch-result": {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.data);
        else pending.reject(new IndexFetchError(message.message, message.status));
        return;
      }
      case "wipe":
        void this.wipe(entry, message.id);
        return;
    }
  }

  private attach(entry: PortEntry, target: IndexTarget): void {
    const key = indexTargetKey(target);
    if (entry.target && indexTargetKey(entry.target) !== key) this.detach(entry);
    entry.target = target;
    let indexEntry = this.indexes.get(key);
    if (!indexEntry) {
      const created: IndexEntry = {
        index: null as unknown as WorkspaceIndex,
        slug: target.workspaceSlug,
        ports: new Set(),
        releaseTimer: null,
      };
      created.index = new WorkspaceIndex(key, this.deps.createStore(target), this.fetcherFor(key), {
        ...this.deps.indexOptions,
        onChange: () => this.broadcastServing(key),
      });
      indexEntry = created;
      this.indexes.set(key, indexEntry);
      void indexEntry.index.start();
    }
    // A renamed workspace keeps its id; later requests use the new slug.
    indexEntry.slug = target.workspaceSlug;
    if (indexEntry.releaseTimer) {
      clearTimeout(indexEntry.releaseTimer);
      indexEntry.releaseTimer = null;
    }
    indexEntry.ports.add(entry);
    entry.port.postMessage({ type: "serving", key, serving: indexEntry.index.isServing() });
    indexEntry.index.requestSync();
  }

  private detach(entry: PortEntry): void {
    if (!entry.target) return;
    const key = indexTargetKey(entry.target);
    entry.target = null;
    const indexEntry = this.indexes.get(key);
    if (!indexEntry) return;
    indexEntry.ports.delete(entry);
    if (indexEntry.ports.size === 0 && !indexEntry.releaseTimer) {
      indexEntry.releaseTimer = setTimeout(() => {
        if (indexEntry.ports.size > 0) return;
        this.indexes.delete(key);
        void indexEntry.index.dispose();
      }, this.releaseDelayMs);
    }
  }

  private async search(
    entry: PortEntry,
    id: number,
    kind: "issues" | "projects",
    params: Parameters<WorkspaceIndex["searchIssues"]>[0],
  ): Promise<void> {
    const indexEntry = entry.target ? this.indexes.get(indexTargetKey(entry.target)) : undefined;
    let result = null;
    try {
      if (indexEntry) {
        result =
          kind === "issues" ? await indexEntry.index.searchIssues(params) : await indexEntry.index.searchProjects(params);
      }
    } catch {
      // The tab falls back to server search.
      result = null;
    }
    entry.port.postMessage({ type: "search-result", id, result });
  }

  private async wipe(entry: PortEntry, id: number): Promise<void> {
    const indexes = [...this.indexes.values()];
    this.indexes.clear();
    for (const indexEntry of indexes) {
      if (indexEntry.releaseTimer) clearTimeout(indexEntry.releaseTimer);
      for (const port of indexEntry.ports) port.target = null;
    }
    await Promise.all(indexes.map((indexEntry) => indexEntry.index.dispose(true).catch(() => undefined)));
    await this.deps.wipeAll().catch(() => undefined);
    entry.port.postMessage({ type: "wiped", id });
  }

  private broadcastServing(key: string): void {
    const indexEntry = this.indexes.get(key);
    if (!indexEntry) return;
    const serving = indexEntry.index.isServing();
    for (const port of indexEntry.ports) port.port.postMessage({ type: "serving", key, serving });
  }

  private fetcherFor(key: string): IndexFetcher {
    const request = async <T>(op: FetchOp, params: { afterNumber?: number; cursor?: string; limit?: number }) =>
      (await this.requestFromTab(key, op, params)) as T;
    return {
      manifest: () => request<SearchIndexManifest>("manifest", {}),
      snapshot: (afterNumber, limit) => request<SearchIndexSnapshotPage>("snapshot", { afterNumber, limit }),
      changes: (cursor, limit) => request<SearchIndexChanges>("changes", { cursor, limit }),
    };
  }

  /** Asks the most recently active attached tab; moves on if it has gone away. */
  private async requestFromTab(
    key: string,
    op: FetchOp,
    params: { afterNumber?: number; cursor?: string; limit?: number },
  ): Promise<unknown> {
    const indexEntry = this.indexes.get(key);
    const candidates = indexEntry ? [...indexEntry.ports].sort((a, b) => b.lastSeen - a.lastSeen) : [];
    for (const entry of candidates) {
      if (!this.ports.has(entry.port) || !entry.target || indexTargetKey(entry.target) !== key) continue;
      try {
        return await this.send(entry, op, indexEntry!.slug, params);
      } catch (err) {
        if (err instanceof PortGoneError) continue;
        throw err;
      }
    }
    throw new Error("no tab is attached to this workspace");
  }

  private send(
    entry: PortEntry,
    op: FetchOp,
    workspaceSlug: string,
    params: { afterNumber?: number; cursor?: string; limit?: number },
  ): Promise<unknown> {
    const id = this.nextFetchId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PortGoneError("tab did not answer"));
      }, this.fetchTimeoutMs);
      this.pending.set(id, { entry, resolve, reject, timer });
      entry.port.postMessage({ type: "fetch", id, op, workspaceSlug, params });
    });
  }

  /** Frees ports whose tab closed without saying so. */
  private sweep(): void {
    const cutoff = this.now() - this.portTimeoutMs;
    for (const entry of [...this.ports.values()]) {
      if (entry.lastSeen < cutoff) this.disconnect(entry.port);
    }
  }
}
