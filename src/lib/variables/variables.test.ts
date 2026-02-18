import { afterEach, beforeEach, expect, test } from "bun:test";
import { setDbForTesting, getDbInMemory, closeDb } from "../persistence";
import {
  getStableDocumentId,
  resolveVariables,
  substituteInString,
  substituteInObject,
} from "./index";
import { loadEnvVars } from "./env-files";
import { flattenToDotPaths } from "./flatten-json";
import { getMagicVariables } from "./magic";
import { resolveRequestVariable } from "./request-vars";

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

test("substituteInString uses resolver when var is missing", () => {
  const resolver = (name: string) =>
    name === "fromResolver" ? "resolved" : undefined;
  expect(
    substituteInString("a {{fromResolver}} b {{missing}}", {}, resolver),
  ).toBe("a resolved b ");
});

test("getMagicVariables returns JetBrains-style dynamic vars", () => {
  const m = getMagicVariables();
  expect(m.$uuid).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(m["$random.uuid"]).toBe(m.$uuid);
  expect(Number(m.$timestamp)).toBeGreaterThan(0);
  expect(m.$isoTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  expect(m.$date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Number(m.$randomInt)).toBeGreaterThanOrEqual(0);
  expect(Number(m.$randomInt)).toBeLessThanOrEqual(1000);
});

test("resolveVariables includes magic variables", async () => {
  const vars = await resolveVariables(
    "default",
    "doc-id",
    "REQ1",
    process.cwd(),
  );
  expect(vars.$uuid).toBeDefined();
  expect(vars.$timestamp).toBeDefined();
  expect(vars.$isoTimestamp).toBeDefined();
  expect(vars.$date).toBeDefined();
  expect(vars.$randomInt).toBeDefined();
});

test("$env.VAR resolves from process.env; plain USER is not system env", () => {
  const vars = loadEnvVars("default", process.cwd());
  if (process.env.USER !== undefined) {
    expect(vars["$env.USER"]).toBe(process.env.USER);
  }
  if (process.env.PATH !== undefined) {
    expect(vars["$env.PATH"]).toBe(process.env.PATH);
  }
  // JetBrains spec: system env only via {{ $env.VAR }}, not plain {{ USER }}
  expect(vars.USER).toBeUndefined();
});

test("{{ $env.VAR }} with optional spaces substitutes correctly", () => {
  const vars = loadEnvVars("default", process.cwd());
  if (process.env.USER !== undefined) {
    expect(substituteInString("user: {{ $env.USER }}", vars)).toBe(
      "user: " + process.env.USER,
    );
  }
});

test("resolveRequestVariable resolves response.body.$.path", () => {
  const map = new Map([
    [
      "LOGIN",
      {
        body: {
          type: "json" as const,
          content: { json: { token: "abc123" } },
        },
        headers: {},
      },
    ],
  ]);
  expect(resolveRequestVariable("LOGIN.response.body.$.json.token", map)).toBe(
    "abc123",
  );
});

test("resolveRequestVariable resolves response.headers", () => {
  const map = new Map([
    [
      "REQ",
      {
        body: { type: "text" as const, content: "" },
        headers: {
          "Content-Type": "application/json",
          Date: "Mon, 01 Jan 2024 00:00:00 GMT",
        },
      },
    ],
  ]);
  expect(resolveRequestVariable("REQ.response.headers.Content-Type", map)).toBe(
    "application/json",
  );
  expect(resolveRequestVariable("REQ.response.headers.Date", map)).toBe(
    "Mon, 01 Jan 2024 00:00:00 GMT",
  );
});

test("flattenToDotPaths: nested JSON becomes dotted paths (JetBrains-style)", () => {
  const out: Record<string, string> = {};
  flattenToDotPaths({ client: { host: { url: "example.org" } } }, "", out);
  expect(out["client.host.url"]).toBe("example.org");
});

test("flattenToDotPaths: keys containing dots use bracket notation", () => {
  const out: Record<string, string> = {};
  flattenToDotPaths({ client: { "host.url": "example.org" } }, "", out);
  expect(out["client.['host.url']"]).toBe("example.org");
  expect(substituteInString("GET {{client.['host.url']}}", out)).toBe(
    "GET example.org",
  );
});

test("substituteInObject: GraphQL query string substitution", () => {
  const graphqlBody = {
    query: "query { user(id: {{userId}}) { name } }",
    variables: {},
  };
  const vars = { userId: "123" };
  const result = substituteInObject(graphqlBody, vars);
  expect(result).toEqual({
    query: "query { user(id: 123) { name } }",
    variables: {},
  });
});

test("substituteInObject: GraphQL variables object substitution", () => {
  const graphqlBody = {
    query: "query Person($id: ID) { person(personID: $id) { name } }",
    variables: {
      id: "{{userId}}",
      name: "{{userName}}",
    },
  };
  const vars = { userId: "123", userName: "John" };
  const result = substituteInObject(graphqlBody, vars);
  expect(result).toEqual({
    query: "query Person($id: ID) { person(personID: $id) { name } }",
    variables: {
      id: "123",
      name: "John",
    },
  });
});

test("substituteInObject: GraphQL query and variables both substituted", () => {
  const graphqlBody = {
    query: "query { user(id: {{userId}}) { name email } }",
    variables: {
      filter: "{{filterValue}}",
    },
  };
  const vars = { userId: "456", filterValue: "active" };
  const result = substituteInObject(graphqlBody, vars);
  expect(result).toEqual({
    query: "query { user(id: 456) { name email } }",
    variables: {
      filter: "active",
    },
  });
});

test("substituteInObject: GraphQL without variables section", () => {
  const graphqlBody = {
    query: "query Query { allFilms { films { title } } }",
  };
  const vars = { someVar: "value" };
  const result = substituteInObject(graphqlBody, vars);
  expect(result).toEqual({
    query: "query Query { allFilms { films { title } } }",
  });
});
