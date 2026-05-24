import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import {
  getStableDocumentId,
  resolveVariables,
  substituteInObject,
  substituteInObjectAsync,
  substituteInString,
  substituteInStringAsync,
} from "./index";
import { loadEnvVars } from "./env-files";
import { flattenToDotPaths } from "./flatten-json";
import { getMagicVariables } from "./magic";
import { isRequestVariableKey, resolveRequestVariable } from "./request-vars";
import { isVscodeRestclientCompatEnabled } from "../runner/vscode-restclient-compat";
import {
  loadRequestVarResults,
  saveRequestVarResult,
} from "../persistence/request-var-store";

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

test("resolveVariables includes JetBrains @-file variables (fileHeader + blockPreamble)", async () => {
  const vars = await resolveVariables("default", "d", "b", process.cwd(), {
    fileHeader: { DOC_ENV_TEST: "production" },
    blockPreamble: { SEGMENT: "beta" },
  });
  expect(vars.DOC_ENV_TEST).toBe("production");
  expect(vars.SEGMENT).toBe("beta");
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
          content: { token: "abc123" },
        },
        headers: {},
      },
    ],
  ]);
  expect(resolveRequestVariable("LOGIN.response.body.$.token", map)).toBe(
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

test("resolveRequestVariable resolves VS Code headers['Name'] syntax", () => {
  const map = new Map([
    [
      "REQ",
      {
        body: { type: "text" as const, content: "" },
        headers: { Date: "Mon, 01 Jan 2024 00:00:00 GMT" },
      },
    ],
  ]);
  expect(resolveRequestVariable("REQ.response.headers['Date']", map)).toBe(
    "Mon, 01 Jan 2024 00:00:00 GMT",
  );
});

test("resolveRequestVariable resolves nested JSONPath ($.json.token)", () => {
  const map = new Map([
    [
      "REQUEST_ONE",
      {
        body: {
          type: "json" as const,
          content: { json: { token: "foobar" } },
        },
        headers: {},
      },
    ],
  ]);
  expect(
    resolveRequestVariable("REQUEST_ONE.response.body.$.json.token", map),
  ).toBe("foobar");
});

test("isRequestVariableKey detects request variable references", () => {
  expect(isRequestVariableKey("LOGIN.response.body.$.token")).toBe(true);
  expect(isRequestVariableKey("REQ.response.headers['Date']")).toBe(true);
  expect(isRequestVariableKey("API_KEY")).toBe(false);
});

test("request variables substitute to empty without # @kulala-vscode-restclient-compat", () => {
  const map = new Map([
    [
      "LOGIN",
      {
        body: { type: "json" as const, content: { token: "abc" } },
        headers: {},
      },
    ],
  ]);
  const resolver = (key: string) => resolveRequestVariable(key, map);
  expect(
    substituteInString("{{LOGIN.response.body.$.token}}", {}, undefined),
  ).toBe("");
  expect(
    substituteInString("{{LOGIN.response.body.$.token}}", {}, resolver),
  ).toBe("abc");
});

test("persisted request var results survive separate runs", () => {
  const docId = "test-doc-vscode-vars";
  saveRequestVarResult(docId, "REQUEST_ONE", {
    body: {
      type: "json",
      content: { json: { token: "from-disk" } },
    },
    headers: { Date: "Mon, 01 Jan 2024 00:00:00 GMT" },
  });
  const loaded = loadRequestVarResults(docId);
  expect(loaded.get("REQUEST_ONE")?.body).toEqual({
    type: "json",
    content: { json: { token: "from-disk" } },
  });
  expect(
    resolveRequestVariable("REQUEST_ONE.response.body.$.json.token", loaded),
  ).toBe("from-disk");
  expect(
    resolveRequestVariable("REQUEST_ONE.response.headers['Date']", loaded),
  ).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
});

test("isVscodeRestclientCompatEnabled respects file and source flags", () => {
  const block = { name: "A" } as import("../parser/types/block").KulalaBlock;
  expect(
    isVscodeRestclientCompatEnabled({ directives: [], blocks: [] }, block),
  ).toBe(false);
  expect(
    isVscodeRestclientCompatEnabled(
      { directives: [], blocks: [], vscodeRestclientCompat: true },
      block,
    ),
  ).toBe(true);
  expect(
    isVscodeRestclientCompatEnabled(
      { directives: [], blocks: [] },
      { ...block, sourceVscodeRestclientCompat: true },
    ),
  ).toBe(true);
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

test("substituteInString: $auth.token() calls are preserved in sync version", () => {
  const result = substituteInString('Bearer {{$auth.token("my-auth")}}', {});
  // Should keep the placeholder since it requires async resolution
  expect(result).toBe('Bearer {{$auth.token("my-auth")}}');
});

test("substituteInStringAsync: resolves $auth.token() calls", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "access-token-123";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    'Bearer {{$auth.token("my-auth")}}',
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("Bearer access-token-123");
});

test("substituteInStringAsync: resolves $auth.idToken() calls", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "idToken" && authId === "my-auth") {
      return "id-token-456";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    'ID: {{$auth.idToken("my-auth")}}',
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("ID: id-token-456");
});

test("substituteInStringAsync: handles multiple occurrences of same variable", async () => {
  const result = await substituteInStringAsync("{{name}} and {{name}} again", {
    name: "test",
  });
  expect(result).toBe("test and test again");
});

test("substituteInStringAsync: handles multiple $auth.token() calls", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "auth1") {
      return "token1";
    }
    if (func === "token" && authId === "auth2") {
      return "token2";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    '{{$auth.token("auth1")}} and {{$auth.token("auth2")}}',
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("token1 and token2");
});

test("substituteInStringAsync: handles same $auth.token() call multiple times", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "same-token";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    '{{$auth.token("my-auth")}} and {{$auth.token("my-auth")}}',
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("same-token and same-token");
});

test("substituteInStringAsync: mixes regular vars and $auth.token() calls", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "token-123";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    '{{base}}/api with {{$auth.token("my-auth")}}',
    { base: "https://example.com" },
    undefined,
    authResolver,
  );
  expect(result).toBe("https://example.com/api with token-123");
});

test("substituteInStringAsync: handles $auth.token() with single quotes", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "token-123";
    }
    return undefined;
  };

  const result = await substituteInStringAsync(
    "Bearer {{$auth.token('my-auth')}}",
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("Bearer token-123");
});

test("substituteInStringAsync: returns empty string when authResolver returns undefined", async () => {
  const authResolver = async (): Promise<string | undefined> => {
    return undefined;
  };

  const result = await substituteInStringAsync(
    'Bearer {{$auth.token("missing")}}',
    {},
    undefined,
    authResolver,
  );
  expect(result).toBe("Bearer ");
});

test("substituteInStringAsync: handles $auth.token() without authResolver", async () => {
  const result = await substituteInStringAsync(
    'Bearer {{$auth.token("my-auth")}}',
    {},
  );
  // Should keep placeholder when no authResolver provided
  expect(result).toBe('Bearer {{$auth.token("my-auth")}}');
});

test("substituteInObjectAsync: resolves $auth.token() in nested objects", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "token-123";
    }
    return undefined;
  };

  const body = {
    header: {
      Authorization: 'Bearer {{$auth.token("my-auth")}}',
    },
    data: "test",
  };

  const result = await substituteInObjectAsync(
    body,
    {},
    undefined,
    authResolver,
  );
  expect(result).toEqual({
    header: {
      Authorization: "Bearer token-123",
    },
    data: "test",
  });
});

test("substituteInObjectAsync: resolves $auth.token() in arrays", async () => {
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token" && authId === "my-auth") {
      return "token-123";
    }
    return undefined;
  };

  const body = {
    items: [
      'Bearer {{$auth.token("my-auth")}}',
      "other",
      'Bearer {{$auth.token("my-auth")}}',
    ],
  };

  const result = await substituteInObjectAsync(
    body,
    {},
    undefined,
    authResolver,
  );
  expect(result).toEqual({
    items: ["Bearer token-123", "other", "Bearer token-123"],
  });
});
