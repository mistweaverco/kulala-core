import { describe, expect, test } from "bun:test";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { getEffectiveJqFilter } from "./effective-operators";

function block(operators: KulalaBlock["operators"]): KulalaBlock {
  return {
    name: "TEST",
    operators,
    request: { method: "GET", url: "https://example.com" },
    scripts: { preRequest: [], postRequest: [] },
  } as unknown as KulalaBlock;
}

describe("getEffectiveJqFilter", () => {
  test("block operator overrides file header", () => {
    const doc = {
      fileHeaderOperators: [{ name: "kulala-jq", args: ".a", lineNumber: 0 }],
    } as KulalaDocument;
    const b = block([{ name: "kulala-jq", args: ".b", lineNumber: 1 }]);
    expect(getEffectiveJqFilter(doc, b)).toBe(".b");
  });

  test("uses file header when block has no jq operator", () => {
    const doc = {
      fileHeaderOperators: [
        { name: "kulala-jq", args: ".header", lineNumber: 0 },
      ],
    } as KulalaDocument;
    const b = block([]);
    expect(getEffectiveJqFilter(doc, b)).toBe(".header");
  });

  test("run-time filter applies when no operator is set", () => {
    const b = block([]);
    expect(getEffectiveJqFilter(undefined, b, ".runtime")).toBe(".runtime");
  });

  test("block operator wins over run-time filter", () => {
    const withBlock = block([
      { name: "kulala-jq", args: ".block", lineNumber: 1 },
    ]);
    expect(getEffectiveJqFilter(undefined, withBlock, ".runtime")).toBe(
      ".block",
    );
  });
});
