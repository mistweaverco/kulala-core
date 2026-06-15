import { expect, test } from "bun:test";
import {
  ensureMultipartContentTypeHeader,
  getFormRequestBody,
  getGraphQLRequestBody,
  getJSONRequestBody,
  getRequestHeaderType,
  isBodyFromFileRef,
  isFileRef,
  isRawMultipartTemplateBody,
  parseFormUrlEncoded,
  parseMultipartBoundaryFromBody,
  parseMultipartBoundaryFromContentType,
  resolveBodyFromFile,
  resolveEffectiveBodyFromFileRef,
  resolveInlineBodyFileRefs,
  stripHttpClientDoubleSlashLineComments,
  substituteGraphQLRequestBody,
} from "./body";

test("getRequestHeaderType returns json for application/json", () => {
  expect(getRequestHeaderType({ "Content-Type": "application/json" })).toBe(
    "json",
  );
  expect(
    getRequestHeaderType({ "content-type": "application/json; charset=utf-8" }),
  ).toBe("json");
});

test("getRequestHeaderType returns form-data for multipart", () => {
  expect(
    getRequestHeaderType({
      "Content-Type": "multipart/form-data; boundary=----",
    }),
  ).toBe("form-data");
});

test("getRequestHeaderType returns form-urlencoded", () => {
  expect(
    getRequestHeaderType({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
  ).toBe("form-urlencoded");
});

test("getRequestHeaderType returns invalid when no content-type", () => {
  expect(getRequestHeaderType({})).toBe("invalid");
  expect(getRequestHeaderType(null)).toBe("invalid");
});

test("getJSONRequestBody returns object as-is", () => {
  const body = { a: 1, b: "x" };
  expect(getJSONRequestBody(body)).toEqual(body);
});

test("getJSONRequestBody returns undefined for non-object", () => {
  expect(getJSONRequestBody("string")).toBeUndefined();
  expect(getJSONRequestBody(null)).toBeUndefined();
});

test("getGraphQLRequestBody extracts query and variables", () => {
  const body = {
    query: "query { x }",
    variables: { id: 1 },
  };
  expect(getGraphQLRequestBody(body)).toEqual({
    query: "query { x }",
    variables: { id: 1 },
  });
});

test("getGraphQLRequestBody returns undefined when no query string", () => {
  expect(getGraphQLRequestBody({})).toBeUndefined();
  expect(getGraphQLRequestBody({ variables: {} })).toBeUndefined();
});

test("getGraphQLRequestBody parses raw GraphQL text from body-from-file", () => {
  const fileContent = [
    "query User {",
    "  viewer {",
    "    bio",
    "  }",
    "}",
  ].join("\n");
  expect(getGraphQLRequestBody(fileContent)).toEqual({
    query: "query User {\n  viewer {\n    bio\n  }\n}",
  });
});

test("getGraphQLRequestBody parses raw GraphQL text with variables from file", () => {
  const fileContent = [
    "query Person($id: ID) {",
    "  person(personID: $id) { name }",
    "}",
    "",
    '{ "id": 1 }',
  ].join("\n");
  expect(getGraphQLRequestBody(fileContent)).toEqual({
    query: "query Person($id: ID) {\n  person(personID: $id) { name }\n}",
    variables: { id: 1 },
  });
});

test("parseFormUrlEncoded parses key=value pairs", () => {
  expect(parseFormUrlEncoded("a=1&b=2")).toEqual({ a: "1", b: "2" });
  expect(parseFormUrlEncoded("name=John+Doe")).toEqual({ name: "John Doe" });
});

test("getFormRequestBody returns object for form-urlencoded", () => {
  const body = { key: "value" };
  expect(getFormRequestBody(body, "form-urlencoded")).toEqual(body);
});

test("getFormRequestBody parses string as form-urlencoded", () => {
  expect(getFormRequestBody("x=1&y=2", "form-urlencoded")).toEqual({
    x: "1",
    y: "2",
  });
});

test("isFileRef returns true for file ref shape", () => {
  expect(isFileRef({ filePath: "/tmp/file.txt" })).toBe(true);
  expect(isFileRef({ filePath: "/a", filename: "b.txt" })).toBe(true);
});

test("isFileRef returns false for plain values", () => {
  expect(isFileRef("string")).toBe(false);
  expect(isFileRef({ path: "/tmp" })).toBe(false);
  expect(isFileRef(null)).toBe(false);
});

test("isBodyFromFileRef returns true for body-from-file shape", () => {
  expect(isBodyFromFileRef({ __bodyFromFile: "./input.json" })).toBe(true);
  expect(isBodyFromFileRef({ __bodyFromFile: "path/to/body.json" })).toBe(true);
});

test("isBodyFromFileRef returns false for other values", () => {
  expect(isBodyFromFileRef("string")).toBe(false);
  expect(isBodyFromFileRef({ filePath: "/tmp" })).toBe(false);
  expect(isBodyFromFileRef({ __bodyFromFile: 123 })).toBe(false);
  expect(isBodyFromFileRef(null)).toBe(false);
});

test("resolveEffectiveBodyFromFileRef merges GRAPHQL file query with inline variables", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-gql-merge-"));
  const queryFile = join(dir, "query.graphql");
  await Bun.write(
    queryFile,
    ["query Film($id: ID) {", "  film(id: $id) { title }", "}"].join("\n"),
  );

  const result = await resolveEffectiveBodyFromFileRef(
    {
      __bodyFromFile: "query.graphql",
      __graphqlVariablesSuffix: '{ "id": 1 }',
    },
    dir,
    "GRAPHQL",
  );

  expect(result).toEqual({
    query: "query Film($id: ID) {\n  film(id: $id) { title }\n}",
    variables: { id: 1 },
  });
});

test("resolveBodyFromFile reads file relative to baseDir", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-resolve-body-"));
  const filePath = join(dir, "payload.txt");
  await Bun.write(filePath, "hello from file");

  const content = await resolveBodyFromFile("payload.txt", dir);
  expect(content).toBe("hello from file");
});

test("resolveBodyFromFile resolves relative path with subdir", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-resolve-body-"));
  const subdir = join(dir, "fixtures");
  await import("fs").then((fs) =>
    fs.promises.mkdir(subdir, { recursive: true }),
  );
  const filePath = join(subdir, "data.json");
  await Bun.write(filePath, '{"x":1}');

  const content = await resolveBodyFromFile("fixtures/data.json", dir);
  expect(content).toBe('{"x":1}');
});

test("getFormRequestBody form-data: raw multipart template returns undefined", () => {
  const raw = `--b\r\nContent-Disposition: form-data; name="x"\r\n\r\n1\r\n--b--\r\n`;
  expect(getFormRequestBody(raw, "form-data")).toBeUndefined();
});

test("isRawMultipartTemplateBody", () => {
  expect(isRawMultipartTemplateBody("--x\n")).toBe(true);
  expect(isRawMultipartTemplateBody(" \n--x")).toBe(true);
  expect(isRawMultipartTemplateBody("// note\n--x")).toBe(true);
  expect(isRawMultipartTemplateBody('{"a":1}')).toBe(false);
  expect(isRawMultipartTemplateBody("a=1&b=2")).toBe(false);
});

test("stripHttpClientDoubleSlashLineComments removes // lines only", () => {
  const raw = `// intro\n\n--b\n// mid\nx\n`;
  expect(stripHttpClientDoubleSlashLineComments(raw)).toBe(`\n--b\nx\n`);
});

test("stripHttpClientDoubleSlashLineComments normalizes CR-only newlines", () => {
  const raw = "--b\r//c\r\r< ./f\r";
  expect(stripHttpClientDoubleSlashLineComments(raw)).toBe("--b\n\n< ./f\n");
});

test("parseMultipartBoundaryFromContentType", () => {
  expect(
    parseMultipartBoundaryFromContentType("multipart/form-data; boundary=abc"),
  ).toBe("abc");
  expect(
    parseMultipartBoundaryFromContentType(
      'multipart/form-data; boundary="x y"',
    ),
  ).toBe("x y");
  expect(parseMultipartBoundaryFromContentType("multipart/form-data")).toBe(
    undefined,
  );
});

test("parseMultipartBoundaryFromBody reads first delimiter line", () => {
  expect(parseMultipartBoundaryFromBody("\n--foo\n")).toBe("foo");
  expect(parseMultipartBoundaryFromBody("preamble\n--z\n")).toBe("z");
  expect(parseMultipartBoundaryFromBody("--z--\n")).toBe("z");
});

test("ensureMultipartContentTypeHeader adds boundary from body", () => {
  const h = ensureMultipartContentTypeHeader(
    { "Content-Type": "multipart/form-data" },
    "--myb\n",
  );
  expect(h["Content-Type"]).toContain("boundary=myb");
});

test("ensureMultipartContentTypeHeader leaves existing boundary", () => {
  const h = ensureMultipartContentTypeHeader(
    { "Content-Type": "multipart/form-data; boundary=keep" },
    "--other\n",
  );
  expect(h["Content-Type"]).toContain("boundary=keep");
  expect(h["Content-Type"]).not.toContain("boundary=other");
});

test("resolveInlineBodyFileRefs substitutes file lines", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "part.bin"), Buffer.from([0, 1, 2, 255]));

  const template = ["--boundary", "< ./part.bin", "--boundary--", ""].join(
    "\r\n",
  );
  const out = await resolveInlineBodyFileRefs(template, dir);
  expect(out.indexOf(Buffer.from([0, 1, 2, 255]))).not.toBe(-1);
  expect(out.indexOf(Buffer.from("< ./part.bin"))).toBe(-1);
});

test("resolveInlineBodyFileRefs keeps same-line suffix after path", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "f.txt"), "Z");

  const template = `< ./f.txt --end--\n`;
  const out = await resolveInlineBodyFileRefs(template, dir);
  expect(out.toString("utf8")).toBe("Z\r\n--end--\r\n");
});

test("resolveInlineBodyFileRefs: blank line after file ref yields single LF before next boundary", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "f.txt"), "BODY");

  const template = [
    "--b",
    'Content-Disposition: form-data; name="first"',
    "",
    "< ./f.txt",
    "",
    "--b--",
  ].join("\n");
  const out = (await resolveInlineBodyFileRefs(template, dir)).toString("utf8");
  expect(out).toContain("BODY\r\n--b--\r\n");
  expect(out).not.toContain("BODY\r\n\r\n--b--\r\n");
});

test("resolveInlineBodyFileRefs: file with trailing LF then boundary line — one LF before --", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "f.txt"), "BODY\n");

  const template = [
    "--boundary",
    'Content-Disposition: form-data; name="first"',
    "",
    "< ./f.txt",
    "--boundary",
    'Content-Disposition: form-data; name="second"',
    "",
    "Text",
    "--boundary--",
  ].join("\n");
  const out = (await resolveInlineBodyFileRefs(template, dir)).toString("utf8");
  expect(out).toContain("BODY\n\r\n--boundary");
  expect(out).not.toContain("BODY\n\n--boundary");
});

test("resolveInlineBodyFileRefs: same-line closing boundary without template newline (IntelliJ)", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "f.txt"), "kulala familiy\n");

  const template = "< ./f.txt --boundary--";
  const out = (await resolveInlineBodyFileRefs(template, dir)).toString("utf8");
  expect(out).toBe("kulala familiy\n\r\n--boundary--\r\n");
});

test("resolveInlineBodyFileRefs: IntelliJ-style multi-part template is busboy-parseable", async () => {
  const { mkdtempSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const { Busboy } = await import("@fastify/busboy");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  writeFileSync(join(dir, "part.txt"), "kulala familiy\n");

  const template = [
    "--boundary",
    'Content-Disposition: form-data; name="first"; filename="part.txt"',
    "",
    "< ./part.txt",
    "--boundary",
    'Content-Disposition: form-data; name="second"; filename="input-second.txt"',
    "",
    "Text",
    "--boundary",
    'Content-Disposition: form-data; name="third";',
    "",
    "< ./part.txt --boundary--",
  ].join("\n");

  const body = await resolveInlineBodyFileRefs(template, dir);
  const err = await new Promise<Error | null>((resolve) => {
    const bb = Busboy({
      headers: {
        "content-type": "multipart/form-data; boundary=boundary",
        "content-length": String(body.length),
      },
    });
    bb.on("error", resolve);
    bb.on("finish", () => resolve(null));
    bb.end(body);
  });
  expect(err).toBeNull();
});

test("resolveInlineBodyFileRefs: trailing LF in file + blank before boundary — one LF before --", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-multipart-"));
  await Bun.write(join(dir, "f.txt"), "BODY\n");

  const template = [
    "--b",
    'Content-Disposition: form-data; name="first"',
    "",
    "< ./f.txt",
    "",
    "--b--",
  ].join("\n");
  const out = (await resolveInlineBodyFileRefs(template, dir)).toString("utf8");
  expect(out).toContain("BODY\n\r\n--b--\r\n");
  expect(out).not.toContain("BODY\n\n--b--\r\n");
});

test("substituteGraphQLRequestBody: unquoted {{ var }} in variables JSON (JetBrains parity)", async () => {
  const sourceBodyText = [
    "query Person($id: ID) {",
    "  person(personID: $id) { name }",
    "}",
    "",
    "{",
    '  "id": {{ PERSON_ID }}',
    "}",
  ].join("\n");

  const parsedBody = {
    query: "query Person($id: ID) {\n  person(personID: $id) { name }\n}",
  };

  const result = await substituteGraphQLRequestBody({
    method: "GRAPHQL",
    originalBody: parsedBody,
    effectiveBody: parsedBody,
    sourceBodyText,
    vars: { PERSON_ID: "1" },
  });

  expect(result).toEqual({
    query: "query Person($id: ID) {\n  person(personID: $id) { name }\n}",
    variables: { id: 1 },
  });
});

test("substituteGraphQLRequestBody: body-from-file with unquoted variables suffix", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-gql-unquoted-"));
  const queryFile = join(dir, "query.graphql");
  await Bun.write(
    queryFile,
    ["query Person($id: ID) {", "  person(personID: $id) { name }", "}"].join(
      "\n",
    ),
  );

  const originalBody = {
    __bodyFromFile: "query.graphql",
    __graphqlVariablesSuffix: '{ "id": {{ PERSON_ID }} }',
  };
  const effectiveBody = await resolveEffectiveBodyFromFileRef(
    originalBody,
    dir,
    "GRAPHQL",
  );

  const result = await substituteGraphQLRequestBody({
    method: "GRAPHQL",
    originalBody,
    effectiveBody,
    vars: { PERSON_ID: "42" },
  });

  expect(result).toEqual({
    query: "query Person($id: ID) {\n  person(personID: $id) { name }\n}",
    variables: { id: 42 },
  });
});
