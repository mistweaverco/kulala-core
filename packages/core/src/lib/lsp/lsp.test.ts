import { beforeEach, afterEach, expect, test } from "bun:test";
import {
  closeDb,
  getDbInMemory,
  setDbForTesting,
  setVariable,
} from "../persistence";
import {
  lspCompletion,
  lspDiagnostics,
  lspHover,
  lspDocumentSymbols,
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

GET https://httpbin.org/get?user={{users[*].name}} HTTP/1.1
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
