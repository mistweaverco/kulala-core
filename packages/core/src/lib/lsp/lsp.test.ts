import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  closeDb,
  getDbInMemory,
  setDbForTesting,
  setVariable,
} from "../persistence";
import { completionPrefixAtCursor } from "./script-api-docs";
import {
  lspCompletion,
  lspDiagnostics,
  lspDocumentSymbols,
  lspHover,
} from "./index";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("lspCompletion includes resolved variables (file header + magic + persistence)", async () => {
  setVariable("global", "X_GLOBAL", "abc");
  const content = `@baseUrl=https://example.com

### One
GET {{baseUrl}}/ping HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/test.http",
    env: "default",
    line: 4,
    column: 8,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("baseUrl")).toBe(true);
  expect(labels.has("X_GLOBAL")).toBe(true);
  expect(labels.has("$timestamp")).toBe(true);
});

test("lspDiagnostics surfaces parser errors", async () => {
  const content = `### One
this is not valid
GET https://example.com HTTP/1.1
`;
  const diags = await lspDiagnostics({ content, filepath: "/tmp/diag.http" });
  expect(diags.length).toBeGreaterThan(0);
  expect(diags[0]!.message.toLowerCase()).toContain(
    "invalid request block line",
  );
});

test("lspDocumentSymbols returns one symbol per block", async () => {
  const content = `### One
GET https://example.com HTTP/1.1

### Two
GET https://example.com HTTP/1.1
`;
  const syms = await lspDocumentSymbols({ content, filepath: "/tmp/sym.http" });
  expect(syms).toHaveLength(2);
  expect(syms[0]!.name).toBe("One");
  expect(syms[1]!.name).toBe("Two");
});

test("lspHover returns plaintext when no request at cursor", async () => {
  const content = `just some text
still not a request`;
  const hover = await lspHover({
    content,
    filepath: "/tmp/hover.http",
    env: "default",
    line: 1,
    column: 1,
  });
  const { contents } = hover;
  expect(contents).not.toBeNull();
  expect(typeof contents).toBe("object");
  expect("kind" in (contents as object)).toBe(true);
  expect((contents as { kind: string }).kind).toBe("plaintext");
});

test("lspCompletion suggests script API inside {% %} body", async () => {
  const content = `### FOO1

< {%
  request.variables.set("users", [
    { name: "Alice" },
    { name: "Bob" },
  ]);
%}

GET https://echo.kulala.app/get?user={{users[*].name}} HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/script.http",
    env: "default",
    // cursor inside script body line "  request.variables.set..."
    line: 4,
    column: 6,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("request.variables.set")).toBe(true);
  expect(labels.has("client.log")).toBe(true);
});

test('lspCompletion suggests variable keys in client.global.get("...")', async () => {
  setVariable("global", "X_GLOBAL", "abc");
  setVariable("global", "__kulala_client_global_headers__", { A: "1" });
  const content = `### One

< {%
  client.global.get("
%}

GET https://example.com HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/script-vars.http",
    env: "default",
    line: 4,
    column: 22,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("X_GLOBAL")).toBe(true);
  expect(labels.has("__kulala_client_global_headers__")).toBe(false);
});

test("lspCompletion suggests variable keys in client.global.get('...')", async () => {
  setVariable("global", "X_GLOBAL", "abc");
  const content = `### One

< {%
  client.global.get('
%}

GET https://example.com HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/script-vars-single.http",
    env: "default",
    line: 4,
    column: 22,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("X_GLOBAL")).toBe(true);
});

test("lspCompletion includes markdown documentation for script API items", async () => {
  const res = await lspCompletion({
    content: `client.log("x");`,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: 8,
    filetype: "javascript",
  });
  const item = res.items.find((i) => i.label === "client.global.get");
  expect(item).toBeDefined();
  expect(item!.detail).toContain("client.global.get");
  expect(item!.documentation?.kind).toBe("markdown");
  expect(item!.documentation?.value).toContain("persist");
  expect(item!.documentation?.value).toContain("```javascript");
});

test("lspHover returns script API docs in external script buffers", async () => {
  const content = `client.global.get("TOKEN");`;
  const hover = await lspHover({
    content,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: 14,
    filetype: "javascript",
  });
  expect(hover.contents).toMatchObject({ kind: "markdown" });
  expect((hover.contents as { value: string }).value).toContain(
    "client.global.get",
  );
  expect((hover.contents as { value: string }).value).toContain("persist");
});

test("lspHover returns script API docs inside inline script blocks", async () => {
  const content = `### One

< {%
  client.log("hi");
%}

GET https://example.com HTTP/1.1
`;
  const hover = await lspHover({
    content,
    filepath: "/tmp/inline.http",
    env: "default",
    line: 4,
    column: 10,
    filetype: "http",
  });
  expect(hover.contents).toMatchObject({ kind: "markdown" });
  expect((hover.contents as { value: string }).value).toContain("client.log");
});

test("completionPrefixAtCursor includes leading $ for $kulala", () => {
  const line = "$kulala";
  expect(completionPrefixAtCursor(line, line.length)).toEqual({
    prefix: "$kulala",
    startCol0: 0,
    endCol0: line.length,
  });
  expect(completionPrefixAtCursor("$kulala.", 8)).toEqual({
    prefix: "$kulala.",
    startCol0: 0,
    endCol0: 8,
  });
  expect(completionPrefixAtCursor("$ku", 3)).toEqual({
    prefix: "$ku",
    startCol0: 0,
    endCol0: 3,
  });
  expect(completionPrefixAtCursor("$kul", 4)).toEqual({
    prefix: "$kul",
    startCol0: 0,
    endCol0: 4,
  });
  expect(completionPrefixAtCursor("req", 3)).toEqual({
    prefix: "req",
    startCol0: 0,
    endCol0: 3,
  });
});

test("lspCompletion textEdit replaces full $kulala prefix", async () => {
  const line = "$kulala";
  const res = await lspCompletion({
    content: line,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: line.length + 1,
    filetype: "javascript",
  });
  const item = res.items.find((i) => i.label === "$kulala.prompt");
  expect(item?.textEdit).toBeDefined();
  expect(item!.textEdit!.range.start.character).toBe(0);
  expect(item!.textEdit!.range.end.character).toBe(line.length);
  expect(item!.textEdit!.newText).toContain("$kulala.prompt");
  expect(item!.insertText).toContain("$kulala.prompt(");
  expect(item!.insertTextFormat).toBe(1); // PlainText — blink.cmp strips `$` from Snippet prefixes
});

test("lspCompletion includes $kulala API items with documentation", async () => {
  const res = await lspCompletion({
    content: `$kulala.prompt("x", "y");`,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: 10,
    filetype: "javascript",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("$kulala.prompt")).toBe(true);
  expect(labels.has("$kulala.request.skip")).toBe(true);
  expect(labels.has("$kulala.client.global.headers.set")).toBe(true);
  const item = res.items.find((i) => i.label === "$kulala.prompt");
  expect(item?.documentation?.value).toContain("Pauses the run");
});

test("lspHover returns $kulala API docs", async () => {
  const hover = await lspHover({
    content: `$kulala.client.global.headers.set("X-A", "1");`,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: 20,
    filetype: "javascript",
  });
  expect((hover.contents as { value: string }).value).toContain(
    "$kulala.client.global.headers.set",
  );
  expect((hover.contents as { value: string }).value).toContain(
    "$kulalaDefaultHeaders",
  );
});

test("lspCompletion suggests script API in external script buffers", async () => {
  const content = `client.log("hello");
request.variables.set("foo", "bar");
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/script.http.js",
    env: "default",
    line: 1,
    column: 8,
    filetype: "javascript",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("client.log")).toBe(true);
  expect(labels.has("request.variables.set")).toBe(true);
  expect(labels.has("run #")).toBe(false);
});

test("lspCompletion suggests kulala operators in // @ comments", async () => {
  const content = `// @kulala-
GET https://example.com HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/operators.http",
    env: "default",
    line: 1,
    column: 12,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("kulala-expect-status-code")).toBe(true);
  expect(labels.has("kulala-curl--")).toBe(true);
});

test('lspCompletion suggests variable keys in request.variables.get("...")', async () => {
  setVariable("global", "X_GLOBAL", "abc");
  const content = `### One

< {%
  request.variables.get("
%}

GET https://example.com HTTP/1.1
`;
  const res = await lspCompletion({
    content,
    filepath: "/tmp/script-req-vars.http",
    env: "default",
    line: 4,
    column: 27,
    filetype: "http",
  });
  const labels = new Set(res.items.map((i) => i.label));
  expect(labels.has("X_GLOBAL")).toBe(true);
});
