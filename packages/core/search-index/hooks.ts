import { useEffect } from "react";
import type { WSClient } from "../api/ws-client";
import type { WSEventType } from "../types";
import { getLocalSearchIndex } from "./instance";

/** Server events after which the local copy is likely behind. */
const SEARCH_INDEX_EVENTS: WSEventType[] = [
  "issue:created",
  "issue:updated",
  "issue:deleted",
  "issue_metadata:changed",
  "issue_properties:changed",
  "comment:created",
  "comment:updated",
  "comment:deleted",
  "project:created",
  "project:updated",
  "project:deleted",
];

/**
 * Keeps the local search index attached to the workspace this tab shows and
 * nudges it to catch up after realtime events, reconnects, and returning to
 * the tab. The worker also catches up on its own every few minutes.
 */
export function useLocalSearchIndexSync(
  wsClient: WSClient | null,
  userId: string | null,
  workspaceId: string | null,
  workspaceSlug: string | null,
): void {
  useEffect(() => {
    if (!userId || !workspaceId || !workspaceSlug) return;
    const index = getLocalSearchIndex();
    index.attach({ userId, workspaceId, workspaceSlug });
    return () => index.detach();
  }, [userId, workspaceId, workspaceSlug]);

  useEffect(() => {
    if (!wsClient) return;
    const poke = () => getLocalSearchIndex().poke();
    const unsubscribes = SEARCH_INDEX_EVENTS.map((event) => wsClient.on(event, poke));
    unsubscribes.push(wsClient.onReconnect(poke));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [wsClient]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") getLocalSearchIndex().poke();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
}
