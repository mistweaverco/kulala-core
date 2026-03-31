import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  getDataDir,
  getDbInMemory,
  setDbForTesting,
  closeDb,
  saveDocument,
  loadDocument,
  listDocumentFilepaths,
  incrementReplayCount,
  getReplayCount,
  listRequestRuns,
  setVariable,
  getVariable,
  getVariables,
  deleteVariable,
} from "./index";
import type { KulalaDocument } from "../parser/types";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("data dir returns a path", () => {
  const dir = getDataDir();
  expect(dir).toBeString();
  expect(dir).toContain("kulala");
});

test("document store: save and load", () => {
  const doc: KulalaDocument = {
    filepath: "/foo/test.http",
    directives: [],
    blocks: [
      {
        name: "REQ1",
        errors: [],
        preamble: [],
        comments: [],
        operators: [],
        request: {
          method: "GET",
          url: "https://example.com",
          headerSection: [],
        },
        scripts: { preRequest: [], postRequest: [] },
        position: { start: 1, end: 5 },
      },
    ],
  };
  saveDocument(doc, "abc123");
  const loaded = loadDocument("/foo/test.http");
  expect(loaded).not.toBeNull();
  expect(loaded!.filepath).toBe("/foo/test.http");
  expect(loaded!.blocks).toHaveLength(1);
  expect(loaded!.blocks[0].name).toBe("REQ1");
});

test("document store: load missing returns null", () => {
  expect(loadDocument("/nonexistent.http")).toBeNull();
});

test("document store: list filepaths", () => {
  saveDocument({ filepath: "/a.http", directives: [], blocks: [] });
  saveDocument({ filepath: "/b.http", directives: [], blocks: [] });
  const list = listDocumentFilepaths();
  expect(list).toContain("/a.http");
  expect(list).toContain("/b.http");
  expect(list).toHaveLength(2);
});

test("replay store: increment and get", () => {
  const count1 = incrementReplayCount("/doc.http", "BLOCK_A");
  expect(count1).toBe(1);
  const count2 = incrementReplayCount("/doc.http", "BLOCK_A");
  expect(count2).toBe(2);
  const run = getReplayCount("/doc.http", "BLOCK_A");
  expect(run).not.toBeNull();
  expect(run!.runCount).toBe(2);
  expect(run!.blockName).toBe("BLOCK_A");
  expect(run!.lastRunAt).toBeTruthy();
});

test("replay store: list request runs", () => {
  incrementReplayCount("/d1.http", "A");
  incrementReplayCount("/d1.http", "B");
  incrementReplayCount("/d2.http", "A");
  const all = listRequestRuns();
  expect(all.length).toBeGreaterThanOrEqual(3);
  const forD1 = listRequestRuns("/d1.http");
  expect(forD1).toHaveLength(2);
});

test("variable store: global set and get", () => {
  setVariable("global", "token", "secret123");
  expect(getVariable("global", "token")).toBe("secret123");
});

test("variable store: document scope", () => {
  setVariable("document", "baseUrl", "https://api.example.com", {
    document: "/proj/api.http",
  });
  expect(
    getVariable("document", "baseUrl", { document: "/proj/api.http" }),
  ).toBe("https://api.example.com");
  expect(getVariable("document", "baseUrl")).toBeUndefined();
});

test("variable store: request scope", () => {
  setVariable("request", "count", 42, {
    document: "/d.http",
    blockName: "REQ1",
  });
  expect(
    getVariable("request", "count", {
      document: "/d.http",
      blockName: "REQ1",
    }),
  ).toBe(42);
});

test("variable store: getVariables returns all for scope", () => {
  setVariable("global", "a", 1);
  setVariable("global", "b", "two");
  const vars = getVariables("global");
  expect(vars.a).toBe(1);
  expect(vars.b).toBe("two");
});

test("variable store: delete", () => {
  setVariable("global", "toDelete", true);
  expect(getVariable("global", "toDelete")).toBe(true);
  const removed = deleteVariable("global", "toDelete");
  expect(removed).toBe(true);
  expect(getVariable("global", "toDelete")).toBeUndefined();
  expect(deleteVariable("global", "toDelete")).toBe(false);
});
