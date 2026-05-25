import { expect, test } from "bun:test";
import {
  getByVariablePath,
  parseStoredVariable,
  resolveVariableReference,
  writeVariableToMaps,
} from "./variable-lookup";

test("parseStoredVariable parses JSON objects and arrays", () => {
  expect(parseStoredVariable('{"a":1}')).toEqual({ a: 1 });
  expect(parseStoredVariable("[1,2]")).toEqual([1, 2]);
  expect(parseStoredVariable("plain")).toBe("plain");
});

test("resolveVariableReference resolves dotted paths on stored objects", () => {
  const flat: Record<string, string> = {};
  writeVariableToMaps(
    "GITHUB_CREDENTIALS",
    { username: "u", password: "p", nested: { token: "t" } },
    flat,
  );
  expect(resolveVariableReference("GITHUB_CREDENTIALS.username", flat)).toBe(
    "u",
  );
  expect(resolveVariableReference("GITHUB_CREDENTIALS.password", flat)).toBe(
    "p",
  );
  expect(
    resolveVariableReference("GITHUB_CREDENTIALS.nested.token", flat),
  ).toBe("t");
  expect(resolveVariableReference("GITHUB_CREDENTIALS", flat)).toBe(
    JSON.stringify({
      username: "u",
      password: "p",
      nested: { token: "t" },
    }),
  );
});

test("getByVariablePath supports bracket keys with dots", () => {
  const value = { "host.url": "example.org" };
  expect(getByVariablePath(value, "['host.url']")).toBe("example.org");
});

test("resolveVariableReference supports JSONPath wildcards (first match)", () => {
  const flat: Record<string, string> = {};
  writeVariableToMaps("users", [{ name: "Alice" }, { name: "Bob" }], flat);
  expect(resolveVariableReference("users[*].name", flat)).toBe("Alice");
});

test("substituteInString resolves {{ CREDENTIALS.password }}", async () => {
  const { substituteInString } = await import("./substitute");
  const flat: Record<string, string> = {};
  writeVariableToMaps("CREDENTIALS", { password: "secret" }, flat);
  expect(substituteInString("Bearer {{CREDENTIALS.password}}", flat)).toBe(
    "Bearer secret",
  );
});
