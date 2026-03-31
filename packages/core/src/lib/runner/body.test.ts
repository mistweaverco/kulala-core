import { expect, test } from "bun:test";
import {
  getRequestHeaderType,
  getJSONRequestBody,
  getGraphQLRequestBody,
  parseFormUrlEncoded,
  getFormRequestBody,
  isFileRef,
  isBodyFromFileRef,
  resolveBodyFromFile,
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
