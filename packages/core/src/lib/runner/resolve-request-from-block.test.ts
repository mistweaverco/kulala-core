import { describe, expect, test } from "bun:test";
import { getDocument } from "../parser/parser";
import { findBlockAtCursor } from "./block";
import { resolveRequestFromBlock } from "./resolve-request-from-block";
import { toCurlAtCursor } from "./request-cursor";

const graphqlContent = `### GQL_TEST

GRAPHQL https://example.com/graphql HTTP/1.1
Accept: application/json

query { foo }

`;

describe("resolveRequestFromBlock", () => {
  test("adds Content-Type application/json for GRAPHQL", async () => {
    const doc = await getDocument(graphqlContent, "/test.http");
    const block = findBlockAtCursor(doc, { line: 5, column: 1 });
    expect(block).not.toBeNull();

    const result = await resolveRequestFromBlock(block!, undefined, {});
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.request.method).toBe("POST");
    expect(result.request.headers["Content-Type"]).toBe("application/json");
    expect(result.request.body).toContain("query");
  });
});

describe("toCurlAtCursor", () => {
  test("includes Content-Type for GRAPHQL requests", async () => {
    const result = await toCurlAtCursor({
      content: graphqlContent,
      filepath: "/test.http",
      line: 5,
      column: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("Content-Type");
    expect(result.curl).toContain("application/json");
    expect(result.curl).toContain("-X");
    expect(result.curl).toContain("POST");
  });
});
