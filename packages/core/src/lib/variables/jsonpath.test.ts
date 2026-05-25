import { expect, test } from "bun:test";
import {
  evaluateJsonPath,
  expressionHasWildcard,
  formatJsonPathResults,
  parseJsonPathSegments,
  splitVariableExpression,
} from "./jsonpath";

test("splitVariableExpression splits root and path", () => {
  expect(splitVariableExpression("users[*].name")).toEqual({
    root: "users",
    path: "[*].name",
  });
  expect(splitVariableExpression("client.host.url")).toEqual({
    root: "client",
    path: ".host.url",
  });
  expect(splitVariableExpression("token")).toEqual({
    root: "token",
    path: "",
  });
});

test("parseJsonPathSegments handles dots, brackets, wildcards, indices", () => {
  expect(parseJsonPathSegments(".host.url")).toEqual([
    { type: "property", name: "host" },
    { type: "property", name: "url" },
  ]);
  expect(parseJsonPathSegments("['host.url']")).toEqual([
    { type: "property", name: "host.url" },
  ]);
  expect(parseJsonPathSegments("[*].name")).toEqual([
    { type: "wildcard" },
    { type: "property", name: "name" },
  ]);
  expect(parseJsonPathSegments("[1].id")).toEqual([
    { type: "index", index: 1 },
    { type: "property", name: "id" },
  ]);
});

test("evaluateJsonPath: users[*].name", () => {
  const users = [
    { name: "Alice", id: 1 },
    { name: "Bob", id: 2 },
    { name: "Charlie", id: 3 },
  ];
  expect(evaluateJsonPath(users, "[*].name")).toEqual([
    "Alice",
    "Bob",
    "Charlie",
  ]);
  expect(formatJsonPathResults(evaluateJsonPath(users, "[*].name"))).toBe(
    "Alice",
  );
});

test("evaluateJsonPath: nested host.url on client object", () => {
  const data = { host: { url: "example.org" } };
  expect(evaluateJsonPath(data, ".host.url")).toEqual(["example.org"]);
});

test("evaluateJsonPath: bracket key with dot", () => {
  const data = { "host.url": "example.org" };
  expect(evaluateJsonPath(data, "['host.url']")).toEqual(["example.org"]);
});

test("expressionHasWildcard detects [*]", () => {
  expect(expressionHasWildcard("[*].name")).toBe(true);
  expect(expressionHasWildcard(".host.url")).toBe(false);
});
