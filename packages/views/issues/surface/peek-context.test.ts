// @vitest-environment node
import { describe, expect, it } from "vitest";
import { locateInColumns } from "./peek-context";

describe("locateInColumns", () => {
  const columns = [["a", "b", "c"], [], ["d"]];

  it("reports the 1-based position and neighbours inside the issue's column", () => {
    expect(locateInColumns(columns, "b")).toEqual({
      index: 2,
      total: 3,
      prevId: "a",
      nextId: "c",
    });
  });

  it("has no neighbour past either end of the column", () => {
    expect(locateInColumns(columns, "a")).toMatchObject({ prevId: null, nextId: "b" });
    expect(locateInColumns(columns, "c")).toMatchObject({ prevId: "b", nextId: null });
    expect(locateInColumns(columns, "d")).toEqual({ index: 1, total: 1, prevId: null, nextId: null });
  });

  it("never steps across columns", () => {
    expect(locateInColumns(columns, "c")?.nextId).toBeNull();
  });

  it("is null for an issue outside every column or without published columns", () => {
    expect(locateInColumns(columns, "zzz")).toBeNull();
    expect(locateInColumns(null, "a")).toBeNull();
    expect(locateInColumns(columns, null)).toBeNull();
  });
});
