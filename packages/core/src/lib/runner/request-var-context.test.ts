import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import { saveRequestVarResult } from "../persistence/request-var-store";
import { createRequestVarContext } from "./request-var-context";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaDocument } from "../parser/types";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("createRequestVarContext loads persisted named request responses", () => {
  const stableDocId = "/tmp/vscode-compat.http";
  saveRequestVarResult(stableDocId, "REQUEST_ONE", {
    body: {
      type: "json",
      content: { json: { token: "saved-earlier" } },
    },
    headers: {},
  });

  const doc: KulalaDocument = {
    filepath: stableDocId,
    directives: [],
    blocks: [],
    vscodeRestclientCompat: true,
  };
  const block = { name: "REQUEST_TWO" } as KulalaBlock;

  const { resolver } = createRequestVarContext(doc, block, stableDocId);
  expect(resolver!("REQUEST_ONE.response.body.$.json.token")).toBe(
    "saved-earlier",
  );
});

test("createRequestVarContext resolves JSONPath array index on response body", () => {
  const stableDocId = "/tmp/vscode-compat.http";
  saveRequestVarResult(stableDocId, "REQUEST_ONE", {
    body: {
      type: "json",
      content: { json: { token: ["saved-earlier"] } },
    },
    headers: {},
  });

  const doc: KulalaDocument = {
    filepath: stableDocId,
    directives: [],
    blocks: [],
    vscodeRestclientCompat: true,
  };
  const block = { name: "REQUEST_TWO" } as KulalaBlock;

  const { resolver } = createRequestVarContext(doc, block, stableDocId);
  expect(resolver!("REQUEST_ONE.response.body.$.json.token[0]")).toBe(
    "saved-earlier",
  );
});

test("createRequestVarContext returns no resolver without compat operator", () => {
  const doc: KulalaDocument = { directives: [], blocks: [] };
  const block = { name: "A" } as KulalaBlock;
  saveRequestVarResult("doc", "A", {
    body: { type: "json", content: { x: 1 } },
    headers: {},
  });
  const { resolver } = createRequestVarContext(doc, block, "doc");
  expect(resolver).toBeUndefined();
});
