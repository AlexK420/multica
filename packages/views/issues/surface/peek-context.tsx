"use client";

import { createContext, useContext } from "react";

/**
 * Side peek: Shift+Click (or Space) on a board card opens that issue in a
 * floating panel over the board, so it can be triaged without leaving the
 * board. The surface owns one peek at a time; see `IssuePeekHost`.
 *
 * State is split across three contexts so each consumer re-renders only for
 * what it reads: cards read the peeked id (to paint their selected state),
 * the board publishes its column order through the stable actions, and only
 * the panel's navigation buttons read the derived position.
 */

/** Ordered issue ids per visible board column, left to right. */
export type IssuePeekColumns = readonly (readonly string[])[];

export interface IssuePeekActions {
  /** Open the peek on `issueId`, replacing whatever is peeked. */
  open: (issueId: string) => void;
  /** Open on `issueId`, or close when it is already the peeked issue. */
  toggle: (issueId: string) => void;
  close: () => void;
  /**
   * The board's current column order, used to step through a column with
   * J / K. `null` when the view has no column order to offer.
   */
  publishColumns: (columns: IssuePeekColumns | null) => void;
}

export interface IssuePeekPosition {
  /** 1-based position inside the peeked issue's column. */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
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
  for (const column of columns) {
    const i = column.indexOf(issueId);
    if (i === -1) continue;
    return {
      index: i + 1,
      total: column.length,
      prevId: i > 0 ? column[i - 1]! : null,
      nextId: i < column.length - 1 ? column[i + 1]! : null,
    };
  }
  return null;
}

export const IssuePeekActionsContext = createContext<IssuePeekActions | null>(null);
export const IssuePeekIdContext = createContext<string | null>(null);
export const IssuePeekPositionContext = createContext<IssuePeekPosition | null>(null);

/** `null` outside a surface that hosts a peek (e.g. a board inside a dialog). */
export function useIssuePeekActions() {
  return useContext(IssuePeekActionsContext);
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
