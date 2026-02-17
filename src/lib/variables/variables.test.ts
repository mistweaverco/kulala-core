import { afterEach, beforeEach, expect, test } from "bun:test";
import { setDbForTesting, getDbInMemory, closeDb } from "../persistence";
import {
  getStableDocumentId,
  resolveVariables,
  substituteInString,
  substituteInObject,
} from "./index";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("stable document ID: uses filepath when present", () => {
  expect(getStableDocumentId("/foo/bar.http", "content")).toBe("/foo/bar.http");
  expect(getStableDocumentId("/a.http", undefined)).toBe("/a.http");
});

test("stable document ID: uses content hash when no filepath", () => {
  const id1 = getStableDocumentId(undefined, "same content");
  const id2 = getStableDocumentId(undefined, "same content");
  expect(id1).toBe(id2);
  expect(id1).toMatch(/^content:[a-f0-9]{64}$/);
});

test("stable document ID: different content gives different id", () => {
  const id1 = getStableDocumentId(undefined, "content A");
  const id2 = getStableDocumentId(undefined, "content B");
  expect(id1).not.toBe(id2);
});

test("substituteInString replaces {{var}} and {{ var }}", () => {
  expect(substituteInString("hello {{name}}", { name: "world" })).toBe(
    "hello world",
  );
  expect(substituteInString("hello {{ name }}", { name: "world" })).toBe(
    "hello world",
  );
  expect(
    substituteInString("{{base}}/api", { base: "https://example.com" }),
  ).toBe("https://example.com/api");
  expect(substituteInString("{{ VAR_NAME1 }}", { VAR_NAME1: "value" })).toBe(
    "value",
  );
  expect(substituteInString("no vars", {})).toBe("no vars");
  expect(substituteInString("{{missing}}", {})).toBe("");
});

test("substituteInObject recurses", () => {
  const out = substituteInObject(
    { a: "{{x}}", b: { c: "{{y}}" } },
    { x: "1", y: "2" },
  );
  expect(out).toEqual({ a: "1", b: { c: "2" } });
});

test("resolveVariables includes persistence vars", async () => {
  const { setVariable } = await import("../persistence");
  setVariable("global", "token", "secret123");
  setVariable("document", "baseUrl", "https://api.example.com", {
    document: "doc-id",
  });
  const vars = await resolveVariables(
    "default",
    "doc-id",
    "REQ1",
    process.cwd(),
  );
  expect(vars.token).toBe("secret123");
  expect(vars.baseUrl).toBe("https://api.example.com");
});
