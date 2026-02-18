import { expect, test } from "bun:test";
import { findBlockAtCursor } from "./block";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";

function makeBlock(name: string, start: number, end: number): KulalaBlock {
  return {
    name,
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: "/",
      headerSection: [],
    },
    scripts: { preRequest: [], postRequest: [] },
    position: { start, end },
  };
}

test("findBlockAtCursor returns block that contains line", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    blocks: [
      makeBlock("A", 1, 10),
      makeBlock("B", 11, 20),
      makeBlock("C", 21, 30),
    ],
  };
  expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe("A");
  expect(findBlockAtCursor(doc, { line: 10, column: 1 })?.name).toBe("A");
  expect(findBlockAtCursor(doc, { line: 11, column: 1 })?.name).toBe("B");
  expect(findBlockAtCursor(doc, { line: 20, column: 1 })?.name).toBe("B");
  expect(findBlockAtCursor(doc, { line: 25, column: 5 })?.name).toBe("C");
});

test("findBlockAtCursor returns null when no block contains line", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    blocks: [makeBlock("A", 1, 10)],
  };
  expect(findBlockAtCursor(doc, { line: 0, column: 1 })).toBeNull();
  expect(findBlockAtCursor(doc, { line: 11, column: 1 })).toBeNull();
});

test("findBlockAtCursor returns first matching block when ranges overlap", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    blocks: [makeBlock("A", 1, 15), makeBlock("B", 10, 20)],
  };
  expect(findBlockAtCursor(doc, { line: 12, column: 1 })?.name).toBe("A");
});
