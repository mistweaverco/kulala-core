import { describe, expect, test } from "bun:test";
import { getDocument } from "./parser";
import { serializeHttp } from "./serde";
import type { KulalaDocument } from "./types/document";
import type { KulalaBlock } from "./types/block";
import { join } from "path";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";

function normalizeDoc(doc: KulalaDocument) {
  const nativeBlocks =
    doc.nativeBlockCount !== undefined
      ? doc.blocks.slice(0, doc.nativeBlockCount)
      : doc.blocks;

  return {
    fileHeaderVariables: doc.fileHeaderVariables ?? {},
    vscodeRestclientCompat: doc.vscodeRestclientCompat ?? false,
    fileHeaderOperators: (doc.fileHeaderOperators ?? []).map((o) => ({
      name: o.name,
      args: o.args,
    })),
    directives: (doc.directives ?? []).map((d) =>
      d.type === "import"
        ? { type: "import" as const, filepath: d.filepath }
        : {
            type: "run" as const,
            target: d.target,
            variableOverrides: d.variableOverrides ?? {},
          },
    ),
    blocks: nativeBlocks.map(normalizeBlock),
  };
}

function normalizeBlock(block: KulalaBlock) {
  return {
    name: block.name,
    preambleVariables: block.preambleVariables ?? {},
    preamble: (block.preamble ?? []).map((e) =>
      "name" in e
        ? { type: "operator" as const, name: e.name, args: e.args }
        : { type: "comment" as const, content: e.content },
    ),
    request: {
      method: block.request.method,
      url: block.request.url,
      httpVersion: block.request.httpVersion,
      requestLineParts: (block.request.requestLineParts ?? []).map((p) =>
        p.type === "url"
          ? { type: "url" as const, line: p.line }
          : { type: "comment" as const, content: p.comment.content },
      ),
      headerSection: (block.request.headerSection ?? []).map((h) =>
        h.type === "header"
          ? { type: "header" as const, name: h.name, value: h.value }
          : { type: "comment" as const, content: h.comment.content },
      ),
      body: block.request.body,
      responseRedirect: block.request.responseRedirect ?? null,
    },
    scripts: {
      preRequest: (block.scripts?.preRequest ?? []).map((s) => ({
        type: s.type,
        lang: s.lang,
        source: s.source,
        filepath: s.filepath,
        content: s.content,
      })),
      postRequest: (block.scripts?.postRequest ?? []).map((s) => ({
        type: s.type,
        lang: s.lang,
        source: s.source,
        filepath: s.filepath,
        content: s.content,
      })),
    },
  };
}

describe("serde: serializeHttp/deserialize via getDocument", () => {
  test("round-trips a realistic .http fixture (native blocks only)", async () => {
    const fixturePath = join(
      import.meta.dir,
      "../../../../../http-example-files/scripts.http",
    );
    const original = await Bun.file(fixturePath).text();

    const doc1 = await getDocument(original, fixturePath);
    const serialized = serializeHttp(doc1);
    const doc2 = await getDocument(serialized, fixturePath);

    expect(normalizeDoc(doc2)).toEqual(normalizeDoc(doc1));
  });

  test("serializes GRAPHQL bodyFromFile with inline variables suffix", async () => {
    const content = `### GQL

GRAPHQL https://api.example.com/graphql HTTP/1.1

< ./query.graphql

{ "id": 1 }
`;
    const doc1 = await getDocument(content, "/tmp/gql.http");
    const serialized = serializeHttp(doc1);
    const doc2 = await getDocument(serialized, "/tmp/gql.http");
    expect(normalizeDoc(doc2)).toEqual(normalizeDoc(doc1));
  });

  test("serializes run/import directives and file-header vars/operators", async () => {
    const content = `@HOST = example.com
# @kulala-vscode-restclient-compat
import ./foo.http
run #BAR (@a=1, @b=two)

### A
GET https://{{HOST}}/ HTTP/1.1
`;
    const doc1 = await getDocument(content, "/tmp/directives.http");
    const serialized = serializeHttp(doc1);
    const doc2 = await getDocument(serialized, "/tmp/directives.http");
    expect(normalizeDoc(doc2)).toEqual(normalizeDoc(doc1));
  });

  test("preserves block-local run #BLOCK directive (does not serialize expanded request)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kulala-core-serde-"));
    const filepath = join(dir, "main.http");
    const content = `### UseLib
run #LIB (@host=example.com)

### LIB
GET https://{{host}}/ HTTP/1.1
`;
    await writeFile(filepath, content, "utf8");

    const doc1 = await getDocument(content, filepath);
    const serialized = serializeHttp(doc1);
    expect(serialized).toContain("### UseLib");
    expect(serialized).toContain("run #LIB (@host=example.com)");
    // Ensure we did not inline the expanded request into UseLib
    const useLibSection =
      serialized.match(/### UseLib[\s\S]*?(?=\n### |\n?$)/)?.[0] ?? "";
    expect(useLibSection).not.toMatch(/GET https:\/\//);

    const doc2 = await getDocument(serialized, filepath);
    expect(normalizeDoc(doc2)).toEqual(normalizeDoc(doc1));
  });

  test("preserves block-local run ./file.http expander block", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kulala-core-serde-"));
    const filepath = join(dir, "main.http");
    const graphqlPath = join(dir, "graphql.http");
    const content = `### RUN_ALL_GRAPHQL_REQUESTS

run ./graphql.http
`;
    await writeFile(
      graphqlPath,
      `### GQL
GRAPHQL https://api.example.com/graphql HTTP/1.1
`,
      "utf8",
    );
    await writeFile(filepath, content, "utf8");

    const doc1 = await getDocument(content, filepath);
    const serialized = serializeHttp(doc1);
    expect(serialized).toContain("### RUN_ALL_GRAPHQL_REQUESTS");
    expect(serialized).toContain("run ./graphql.http");
    expect(serialized).not.toContain("GET /");

    const doc2 = await getDocument(serialized, filepath);
    expect(normalizeDoc(doc2)).toEqual(normalizeDoc(doc1));
  });

  test("serializeHttp: exactly one blank line after each ###", async () => {
    const content = `### A
GET https://example.com HTTP/1.1

### B

run #A
`;
    const doc = await getDocument(content, "/tmp/blanklines.http");
    const serialized = serializeHttp(doc);
    // For each block, ensure `### <name>\n\n` (one blank line) and not `\n\n\n`.
    expect(serialized).toContain("### A\n\n");
    expect(serialized).not.toContain("### A\n\n\n");
    expect(serialized).toContain("### B\n\n");
    expect(serialized).not.toContain("### B\n\n\n");
  });

  test("serializeHttp: emits a blank line after pre-request scripts", async () => {
    const content = `### S
< {%
  client.log("hi")
%}
GET https://example.com HTTP/1.1
`;
    const doc = await getDocument(content, "/tmp/pre-script-blank.http");
    const serialized = serializeHttp(doc);
    expect(serialized).toContain("%}\n\nGET https://example.com HTTP/1.1");
  });

  test("serializeHttp: emits blank line between post-request scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kulala-core-serde-"));
    const filepath = join(dir, "main.http");
    await writeFile(join(dir, "simple.js"), 'console.log("x")\n', "utf8");
    const content = `### X
GET https://example.com HTTP/1.1

> ./simple.js
> {%
  client.log("hi")
%}
`;
    const doc = await getDocument(content, filepath);
    const serialized = serializeHttp(doc);
    expect(serialized).toContain("> ./simple.js");
    expect(serialized).toMatch(/>\s+\.\/simple\.js\n\n>\s+\{%/);
  });

  test("serializeHttp: does not leave trailing blank line for requests without body/scripts", async () => {
    const content = `### A
GET https://example.com HTTP/1.1
`;
    const doc = await getDocument(content, "/tmp/no-trailing-blank.http");
    const serialized = serializeHttp(doc);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
  });

  test("serializeHttp: simple.http has single blank line between blocks", async () => {
    const fixturePath = join(
      import.meta.dir,
      "../../../../../http-example-files/simple.http",
    );
    const original = await Bun.file(fixturePath).text();
    const doc = await getDocument(original, fixturePath);
    const serialized = serializeHttp(doc);
    expect(serialized).not.toContain("\n\n\n###");
    expect(serialized.endsWith("\n\n")).toBe(false);
  });

  test("serializeHttp: normalizes // @ operators to # @", async () => {
    const content = `### bar

// @kulala-curl--insecure
GET https://example.com HTTP/1.1
`;
    const doc = await getDocument(content, "/tmp/op-style.http");
    const serialized = serializeHttp(doc);
    expect(serialized).toContain("# @kulala-curl--insecure");
    expect(serialized).not.toContain("// @kulala-curl--insecure");
  });

  test("serializeHttp: inserts blank line between operators and request", async () => {
    const content = `### bar
// @kulala-curl--insecure
GET https://example.com HTTP/1.1
`;
    const doc = await getDocument(content, "/tmp/op-blank.http");
    const serialized = serializeHttp(doc);
    expect(serialized).toContain(
      "# @kulala-curl--insecure\n\nGET https://example.com HTTP/1.1",
    );
  });

  test("serializeHttp: simple.http round-trips without formatting drift", async () => {
    const fixturePath = join(
      import.meta.dir,
      "../../../../../http-example-files/simple.http",
    );
    const original = await Bun.file(fixturePath).text();
    const doc = await getDocument(original, fixturePath);
    const serialized = serializeHttp(doc);

    expect(serialized).toBe(original);
    expect(serialized).not.toContain("#   #");
    expect(serialized).toContain("# @kulala-curl--insecure");
    expect(serialized).not.toContain("lang=js");

    const queryBlock = doc.blocks.find((b) => b.name.includes("QUERY_PARAMS"));
    expect(queryBlock?.blankLineBeforeRequest).toBe(true);
    expect(
      queryBlock?.request.requestLineParts?.some(
        (p) => p.type === "comment" && p.comment.content.startsWith("&"),
      ),
    ).toBe(true);
  });
});
