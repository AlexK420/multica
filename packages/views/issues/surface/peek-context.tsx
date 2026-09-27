"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useIssueOpeningStore, type IssueOpenMode } from "@multica/core/issues/stores/issue-opening-store";

/**
 * Side peek: Shift+Click (or Space) on an issue — a board or swimlane card, a
 * list, table or gantt row — opens it in a floating panel over the view, so it
 * can be triaged without leaving the view. The surface owns one peek at a
 * time; see `IssuePeekHost`.
 *
 * State is split across three contexts so each consumer re-renders only for
 * what it reads: cards and rows read the peeked id (to paint their peeked
 * state), views publish their order through the stable actions, and only the
 * panel's navigation reads the derived position.
 */

/**
 * The element that stands for an issue in a view carries this attribute with
 * the issue id: the host finds it to keep the peeked issue in view, and reads
 * it to peek the issue under the pointer.
 */
export const PEEK_TARGET_ATTR = "data-peek-target";

/**
 * The peeked state of a row (list, gantt): a brand tint plus a leading bar.
 * The bar is a shadow, so it stays visible under the row's hover background.
 * The tint is opaque, for rows that sit over sticky or scrolling content.
 */
export const PEEKED_ROW_CLASS =
  "data-[peeked]:bg-[color-mix(in_oklab,var(--brand)_6%,var(--background))] data-[peeked]:shadow-[inset_2px_0_0_var(--brand)]";

/**
 * Ordered issue ids per visible column, left to right. Views without columns
 * (list, table, gantt) publish a single column in display order.
 */
export type IssuePeekColumns = readonly (readonly string[])[];

export interface IssuePeekActions {
  /** Open the peek on `issueId`, replacing whatever is peeked. */
  open: (issueId: string) => void;
  /** Open on `issueId`, or close when it is already the peeked issue. */
  toggle: (issueId: string) => void;
  close: () => void;
  /**
   * The view's current order, used to step with J / K (within a column) and
   * H / L (across columns). `null` when the view has no order to offer.
   */
  publishColumns: (columns: IssuePeekColumns | null) => void;
}

export interface IssuePeekPosition {
  /** 1-based position inside the peeked issue's column. */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  /**
   * The nearest non-empty column on either side, at the same row (clamped to
   * that column's length) — the card a sideways step lands on.
   */
  leftId: string | null;
  rightId: string | null;
}

/**
 * Where `issueId` sits in the published columns, or `null` when it is in none
 * of them (a filtered-out issue, or a view that published no order).
 */
export function locateInColumns(
  columns: IssuePeekColumns | null,
  issueId: string | null,
): IssuePeekPosition | null {
  if (!columns || !issueId) return null;
  for (let c = 0; c < columns.length; c++) {
    const column = columns[c]!;
    const i = column.indexOf(issueId);
    if (i === -1) continue;
    const across = (step: 1 | -1) => {
      for (let n = c + step; n >= 0 && n < columns.length; n += step) {
        const neighbour = columns[n]!;
        if (neighbour.length > 0) return neighbour[Math.min(i, neighbour.length - 1)]!;
      }
      return null;
    };
    return {
      index: i + 1,
      total: column.length,
      prevId: i > 0 ? column[i - 1]! : null,
      nextId: i < column.length - 1 ? column[i + 1]! : null,
      leftId: across(-1),
      rightId: across(1),
    };
  }
  return null;
}

/** Shift always peeks; plain clicks follow the preference. Modified clicks stay native. */
export function isPeekClick(
  event: Pick<MouseEvent, "button" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">,
  openMode: IssueOpenMode = "page",
) {
  return event.button === 0 && (event.shiftKey || openMode === "peek") &&
    !event.metaKey && !event.ctrlKey && !event.altKey;
}

export const IssuePeekActionsContext = createContext<IssuePeekActions | null>(null);
export const IssuePeekIdContext = createContext<string | null>(null);
export const IssuePeekPositionContext = createContext<IssuePeekPosition | null>(null);

/** `null` outside a surface that hosts a peek (e.g. a board inside a dialog). */
export function useIssuePeekActions() {
  return useContext(IssuePeekActionsContext);
}

/** The peeked issue id, for views that mark rows without a per-row hook. */
export function useIssuePeekId() {
  return useContext(IssuePeekIdContext);
}

export function useIsIssuePeeked(issueId: string) {
  return useContext(IssuePeekIdContext) === issueId;
}

export function useIssuePeekOpen() {
  return useContext(IssuePeekIdContext) !== null;
}

export function useIssuePeekPosition() {
  return useContext(IssuePeekPositionContext);
}

/** Shared by card/row links and the table's non-link click targets. */
export function useIssuePeekClick() {
  const peek = useIssuePeekActions();
  const openMode = useIssueOpeningStore((s) => s.openMode);
  return useCallback((issueId: string, event?: React.MouseEvent) => {
    if (!peek || event?.defaultPrevented) return false;
    if (event ? !isPeekClick(event, openMode) : openMode !== "peek") return false;
    event?.preventDefault();
    // An ordinary click opens (or keeps open) the issue. Only the explicit
    // preview shortcut toggles it closed, matching Space.
    if (event?.shiftKey) peek.toggle(issueId);
    else peek.open(issueId);
    return true;
  }, [peek, openMode]);
}

/** Empty outside a peek host, so other issue links retain normal navigation. */
export function useIssuePeekLinkProps(issueId: string) {
  const peek = useIssuePeekActions();
  const handlePeekClick = useIssuePeekClick();
  return useMemo(
    () =>
      peek
        ? {
            // Keep the shift-click from extending the text selection.
            onMouseDown: (event: React.MouseEvent) => {
              if (event.shiftKey) event.preventDefault();
            },
            onClick: (event: React.MouseEvent) => {
              handlePeekClick(issueId, event);
            },
          }
        : {},
    [peek, handlePeekClick, issueId],
  );
}
