import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";
import {
  closeDb,
  getDbInMemory,
  getVariable,
  listHistoryEntries,
  setDbForTesting,
  setVariable,
} from "../persistence";
import { doRequestFromBlock } from "./doRequest";
import type { KulalaOperator } from "../parser/types/operator";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

function makeBlock(overrides: Partial<KulalaBlock> = {}): KulalaBlock {
  return {
    name: "TEST_BLOCK",
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
    },
    scripts: { preRequest: [], postRequest: [] },
    position: { start: 1, end: 10 },
    ...overrides,
  };
}

beforeAll(() => {
  // Set test environment to prevent browser opening
  process.env.NODE_ENV = "test";

  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const path = u.pathname;
      const method = req.method;
      if (path === "/get" && method === "GET") {
        return Response.json({ json: { success: true, url: baseUrl } });
      }
      if (path === "/auth" && method === "GET") {
        return Response.json({
          authorization: req.headers.get("authorization"),
        });
      }
      if (path === "/path" && method === "GET") {
        return Response.json({
          url: req.url,
          headers: {
            "x-custom": req.headers.get("x-custom"),
          },
        });
      }
      if (path === "/post-query-echo" && method === "POST") {
        return Response.json({ url: req.url });
      }
      if (path === "/post" && method === "POST") {
        return Response.json({ received: true });
      }
      if (path === "/echo-body" && method === "POST") {
        const raw = await req.text();
        return Response.json({ echoed: raw });
      }
      if (path === "/graphql" && method === "POST") {
        const contentType = req.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "Content-Type must be application/json" }],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const raw = await req.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return new Response(
            JSON.stringify({ errors: [{ message: "Body is not valid JSON" }] }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (typeof parsed !== "object" || parsed === null) {
          return new Response(
            JSON.stringify({ errors: [{ message: "Body must be an object" }] }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const obj = parsed as Record<string, unknown>;
        if ("data" in obj && Object.keys(obj).length === 1) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    "Body must be { query, variables }, not wrapped in data",
                },
              ],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (typeof obj.query !== "string") {
          return new Response(
            JSON.stringify({
              errors: [{ message: "Body must have query as a string" }],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (
          "variables" in obj &&
          obj.variables !== undefined &&
          (typeof obj.variables !== "object" || obj.variables === null)
        ) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "variables must be an object when present" }],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (obj.query.includes("\\\\") || obj.query.includes("\\{")) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  message:
                    "Query must not be double-escaped (no backslash-brace)",
                },
              ],
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        return Response.json({ data: {} });
      }
      if (path === "/text" && method === "GET") {
        return new Response("plain text response", {
          headers: { "Content-Type": "text/plain" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  // Bun's type allows `port` to be undefined; once started it will be set.
  if (server.port === undefined) {
    throw new Error("Test server did not expose a listening port");
  }
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop();
});

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("doRequestFromBlock: GET request returns success response (real got)", async () => {
  const block = makeBlock();
  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.status).toBe(200);
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content).toEqual({
        json: { success: true, url: baseUrl },
      });
    }
    expect(result.timings).toHaveProperty("dns");
    expect(result.timings).toHaveProperty("tcp");
    expect(result.timings).toHaveProperty("firstByte");
    expect(result.timings).toHaveProperty("startTransfer");
    expect(result.timings).toHaveProperty("request");
    expect(result.timings).toHaveProperty("tls");
    expect(result.timings).toHaveProperty("redirect");
    expect(result.timings).toHaveProperty("total");
    expect(result).toHaveProperty("url");
    expect(typeof result.url).toBe("string");
    expect(result.url.length).toBeGreaterThan(0);
  }
});

test("doRequestFromBlock: substitutes URL and headers when vars provided", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `http://{{host}}/path`,
      headerSection: [{ type: "header", name: "X-Custom", value: "{{token}}" }],
    },
  });
  const vars = { host: `localhost:${server.port}`, token: "secret123" };

  const result = await doRequestFromBlock(
    block,
    undefined,
    vars,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
});

test("doRequestFromBlock: # @kulala-prompt returns a prompt response when variable missing", async () => {
  const block = makeBlock({
    operators: [{ name: "kulala-prompt", args: "TOKEN", lineNumber: 1 } as any],
    request: {
      method: "GET",
      url: `${baseUrl}/get?token={{TOKEN}}` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );

  expect(result.success).toBe(false);
  if (!result.success && "prompt" in result) {
    expect(result.prompt).toBe(true);
    expect(result.promptType).toBe("custom");
    expect(result.inputs[0]?.id).toBe("TOKEN");
  }
});

test("doRequestFromBlock: @kulala-prompt supports quoted label + var name (continue id remains var)", async () => {
  const block = makeBlock({
    operators: [
      {
        name: "kulala-prompt",
        args: `"What is your name?" NAME`,
        lineNumber: 1,
      } as any,
    ],
    request: {
      method: "GET",
      url: `${baseUrl}/get?name={{NAME}}` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );

  expect(result.success).toBe(false);
  if (!result.success && "prompt" in result) {
    expect(result.prompt).toBe(true);
    expect(result.promptType).toBe("custom");
    expect(result.inputs[0]?.id).toBe("NAME");
    expect(result.inputs[0]?.label).toBe("What is your name?");
  }
});

test("doRequestFromBlock: prompt variable is single-use (deleted after next run of this request)", async () => {
  // Simulate a completed `continue` by storing a request-scoped var.
  setVariable("request", "NAME", "marco", {
    document: "stable-doc",
    blockName: "TEST_BLOCK",
  });
  expect(
    getVariable("request", "NAME", {
      document: "stable-doc",
      blockName: "TEST_BLOCK",
    }),
  ).toBe("marco");

  const block = makeBlock({
    operators: [
      {
        name: "kulala-prompt",
        args: `"What is your name?" NAME`,
        lineNumber: 1,
      } as any,
    ],
    request: {
      method: "GET",
      url: `${baseUrl}/get?name={{NAME}}` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    { NAME: "marco" }, // represents resolved vars for this run
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );

  expect(result).toHaveProperty("success", true);
  expect(
    getVariable("request", "NAME", {
      document: "stable-doc",
      blockName: "TEST_BLOCK",
    }),
  ).toBeUndefined();
});

test("doRequestFromBlock: # @kulala-file-contents-to-variable loads file content into vars for substitution", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const fs = await import("fs/promises");
  const dir = mkdtempSync(join(tmpdir(), "kulala-op-"));
  const httpFilePath = join(dir, "request.http");
  await fs.writeFile(join(dir, "v.txt"), "hello-world", "utf-8");

  const block = makeBlock({
    operators: [
      {
        name: "kulala-file-contents-to-variable",
        args: "FOO v.txt",
        lineNumber: 1,
      } as any,
    ],
    request: {
      method: "GET",
      url: `${baseUrl}/path?name={{FOO}}` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    httpFilePath,
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );

  expect(result).toHaveProperty("success", true);
  if (result.success && result.body.type === "json") {
    expect(String(result.body.content.url ?? "")).toContain("name=hello-world");
  }
});

test("doRequestFromBlock: # @kulala-expect-status-code returns error when status does not match", async () => {
  const block = makeBlock({
    operators: [
      {
        name: "kulala-expect-status-code",
        args: "201",
        lineNumber: 1,
      } as any,
    ],
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );

  expect(result.success).toBe(false);
  if (!result.success && "error" in result) {
    expect(result.error).toContain("Expected status code");
  }
});

test("doRequestFromBlock: # @timeout triggers a timeout against a slow endpoint", async () => {
  const block = makeBlock({
    operators: [
      {
        name: "timeout",
        args: "50 ms", // 50 ms timeout should trigger against our 100ms delayed endpoint
        lineNumber: 1,
      } as KulalaOperator,
    ],
    request: {
      method: "GET",
      url: `${baseUrl}/slow` as KulalaHttpURL,
      headerSection: [],
    },
  });

  // Add /slow handler by creating a second server is overkill; reuse the existing one by hitting an undefined path
  // would return fast 404. Instead, we simulate slowness via a query parameter and server-side delay.
  // Our test server doesn't have /slow, so we must add it there; simplest is to call /text?delay=...
  // but fetch() ignores. We'll just use /text and set a tiny timeout to provoke curl DNS/connection?
  // Reliable: create a dedicated slow server.
  const slowServer = Bun.serve({
    port: 0,
    async fetch() {
      await new Promise((r) => setTimeout(r, 100));
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    },
  });
  if (slowServer.port === undefined) {
    throw new Error("Slow server did not expose a listening port");
  }
  const slowUrl = `http://localhost:${slowServer.port}/slow`;

  const slowBlock = makeBlock({
    operators: block.operators,
    request: {
      method: "GET",
      url: slowUrl as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    slowBlock,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  slowServer.stop();

  expect(result.success).toBe(false);
});

test("doRequestFromBlock: # @timeout 5 s uses seconds for curl (not milliseconds)", async () => {
  const slowServer = Bun.serve({
    port: 0,
    async fetch() {
      await new Promise((r) => setTimeout(r, 200));
      return new Response("ok", { headers: { "Content-Type": "text/plain" } });
    },
  });
  if (slowServer.port === undefined) {
    throw new Error("Slow server did not expose a listening port");
  }
  const slowUrl = `http://localhost:${slowServer.port}/slow`;

  const block = makeBlock({
    operators: [
      {
        name: "timeout",
        args: "5 s",
        lineNumber: 1,
      } as KulalaOperator,
    ],
    request: {
      method: "GET",
      url: slowUrl as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  slowServer.stop();

  // 5 s budget should allow a 200 ms response (would fail if 5000 s were passed to curl).
  expect(result.success).toBe(true);
});

test("doRequestFromBlock: // @no-redirect does not follow redirects (keeps 302)", async () => {
  const redirectServer = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/from") {
        return new Response("", { status: 302, headers: { Location: "/to" } });
      }
      if (u.pathname === "/to") {
        return new Response("ok", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  if (redirectServer.port === undefined) {
    throw new Error("Redirect server did not expose a listening port");
  }
  const base = `http://localhost:${redirectServer.port}`;

  const block = makeBlock({
    operators: [{ name: "no-redirect", lineNumber: 1 } as any],
    request: {
      method: "GET",
      url: `${base}/from` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  redirectServer.stop();

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.status).toBe(302);
  }
});

test("doRequestFromBlock: // @no-auto-encoding sends form-urlencoded body without encoding", async () => {
  const formServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const raw = await req.text();
      return Response.json({ raw });
    },
  });
  if (formServer.port === undefined) {
    throw new Error("Form server did not expose a listening port");
  }
  const base = `http://localhost:${formServer.port}`;

  const block = makeBlock({
    operators: [{ name: "no-auto-encoding", lineNumber: 1 } as any],
    request: {
      method: "POST",
      url: `${base}/` as KulalaHttpURL,
      headerSection: [
        {
          type: "header",
          name: "Content-Type",
          value: "application/x-www-form-urlencoded",
        },
      ],
      body: { name: "@#$somebody" },
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  formServer.stop();

  expect(result.success).toBe(true);
  if (result.success && result.body.type === "json") {
    expect(String(result.body.content.raw ?? "")).toBe("name=@#$somebody");
  }
});

test("doRequestFromBlock: cookie jar stores Set-Cookie and sends Cookie on subsequent request (unless @no-cookie-jar)", async () => {
  const cookieServer = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/set") {
        return new Response("ok", {
          status: 200,
          headers: { "Set-Cookie": "sid=abc; Path=/; HttpOnly" },
        });
      }
      if (u.pathname === "/echo") {
        return Response.json({ cookie: req.headers.get("cookie") ?? "" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  if (cookieServer.port === undefined) {
    throw new Error("Cookie server did not expose a listening port");
  }
  const base = `http://localhost:${cookieServer.port}`;

  const setBlock = makeBlock({
    request: {
      method: "GET",
      url: `${base}/set` as KulalaHttpURL,
      headerSection: [],
    },
  });
  const echoBlock = makeBlock({
    request: {
      method: "GET",
      url: `${base}/echo` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const r1 = await doRequestFromBlock(
    setBlock,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  expect(r1.success).toBe(true);

  const r2 = await doRequestFromBlock(
    echoBlock,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  expect(r2.success).toBe(true);
  if (r2.success && r2.body.type === "json") {
    expect(String(r2.body.content.cookie ?? "")).toContain("sid=abc");
  }

  const noJarEcho = makeBlock({
    operators: [{ name: "no-cookie-jar", lineNumber: 1 } as any],
    request: {
      method: "GET",
      url: `${base}/echo` as KulalaHttpURL,
      headerSection: [],
    },
  });
  const r3 = await doRequestFromBlock(
    noJarEcho,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  expect(r3.success).toBe(true);
  if (r3.success && r3.body.type === "json") {
    expect(String(r3.body.content.cookie ?? "")).toBe("");
  }

  cookieServer.stop();
});

test("doRequestFromBlock: cookies set on redirect response are sent to the next hop (regression)", async () => {
  const redirectCookieServer = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/set") {
        return new Response("", {
          status: 302,
          headers: {
            Location: "/final",
            "Set-Cookie": "sid=abc; Path=/",
          },
        });
      }
      if (u.pathname === "/final") {
        return Response.json({ cookie: req.headers.get("cookie") ?? "" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  if (redirectCookieServer.port === undefined) {
    throw new Error("Redirect cookie server did not expose a listening port");
  }
  const base = `http://localhost:${redirectCookieServer.port}`;

  const block = makeBlock({
    request: {
      method: "GET",
      url: `${base}/set` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  redirectCookieServer.stop();

  expect(result.success).toBe(true);
  if (result.success && result.body.type === "json") {
    expect(String(result.body.content.cookie ?? "")).toContain("sid=abc");
  }
});

test("doRequestFromBlock: @no-cookie-jar prevents redirect cookie propagation (regression)", async () => {
  const redirectCookieServer = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/set") {
        return new Response("", {
          status: 302,
          headers: {
            Location: "/final",
            "Set-Cookie": "sid=abc; Path=/",
          },
        });
      }
      if (u.pathname === "/final") {
        return Response.json({ cookie: req.headers.get("cookie") ?? "" });
      }
      return new Response("not found", { status: 404 });
    },
  });
  if (redirectCookieServer.port === undefined) {
    throw new Error("Redirect cookie server did not expose a listening port");
  }
  const base = `http://localhost:${redirectCookieServer.port}`;

  const block = makeBlock({
    operators: [{ name: "no-cookie-jar", lineNumber: 1 } as any],
    request: {
      method: "GET",
      url: `${base}/set` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  redirectCookieServer.stop();

  expect(result.success).toBe(true);
  if (result.success && result.body.type === "json") {
    expect(String(result.body.content.cookie ?? "")).toBe("");
  }
});

test("doRequestFromBlock: request history records entries unless // @no-log", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
    },
  });
  const r1 = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  expect(r1.success).toBe(true);
  const hist1 = listHistoryEntries(10);
  expect(hist1.length).toBeGreaterThan(0);

  const noLogBlock = makeBlock({
    operators: [{ name: "no-log", lineNumber: 1 } as any],
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
    },
  });
  const before = listHistoryEntries(100).length;
  const r2 = await doRequestFromBlock(
    noLogBlock,
    "/tmp/example.http",
    undefined,
    "stable-doc",
    undefined,
    "default",
    { globalHeaders: {} },
  );
  expect(r2.success).toBe(true);
  const after = listHistoryEntries(100).length;
  expect(after).toBe(before);
});

test("doRequestFromBlock: applies client.global.headers.set from pre-request script", async () => {
  const flow = { globalHeaders: {} as Record<string, string> };
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/path` as KulalaHttpURL,
      headerSection: [],
    },
    scripts: {
      preRequest: [
        {
          type: "preRequest",
          lang: "js",
          content: `client.global.headers.set("X-Custom", "from-flow");`,
          lineNumber: 1,
        },
      ],
      postRequest: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    undefined,
    undefined,
    "default",
    flow,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success && result.body.type === "json") {
    expect(result.body.content.headers["x-custom"]).toBe("from-flow");
  }
});

test("doRequestFromBlock: applies client.global.headers.set from post-request script to subsequent requests in same run", async () => {
  const flow = { globalHeaders: {} as Record<string, string> };

  const first = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
    },
    scripts: {
      preRequest: [],
      postRequest: [
        {
          type: "postRequest",
          lang: "js",
          content: `client.global.headers.set("X-Custom", "from-post");`,
          lineNumber: 1,
        },
      ],
    },
  });

  const second = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/path` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const r1 = await doRequestFromBlock(
    first,
    "/tmp/example.http",
    undefined,
    undefined,
    undefined,
    "default",
    flow,
  );
  expect(r1).toHaveProperty("success", true);

  const r2 = await doRequestFromBlock(
    second,
    "/tmp/example.http",
    undefined,
    undefined,
    undefined,
    "default",
    flow,
  );
  expect(r2).toHaveProperty("success", true);
  if (r2.success && r2.body.type === "json") {
    expect(r2.body.content.headers["x-custom"]).toBe("from-post");
  }
});

test("doRequestFromBlock: pre-request Lua variables are available for substitution", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/path?name={{NAME}}` as KulalaHttpURL,
      headerSection: [],
    },
    scripts: {
      preRequest: [
        {
          type: "preRequest",
          lang: "lua",
          content: `request.variables.set("NAME", "kulala")`,
          lineNumber: 1,
        },
      ],
      postRequest: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      const url = String(result.body.content.url ?? "");
      expect(url).toContain("name=kulala");
    }
  }
});

test("doRequestFromBlock: pre-request JS with await still substitutes {{NAME}} in URL", async () => {
  const block = makeBlock({
    request: {
      method: "POST",
      url: `${baseUrl}/post-query-echo?name={{NAME}}` as KulalaHttpURL,
      headerSection: [
        { type: "header", name: "Content-Type", value: "application/json" },
      ],
      body: "{}",
    },
    scripts: {
      preRequest: [
        {
          type: "preRequest",
          lang: "js",
          content: `await Promise.resolve();
request.variables.set("NAME", "kulala");`,
          lineNumber: 1,
        },
      ],
      postRequest: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    "/tmp/example.http",
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      const url = String(result.body.content.url ?? "");
      expect(url).toContain("name=kulala");
    }
  }
});

test("doRequestFromBlock: encodes Authorization Basic username:password", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/auth` as KulalaHttpURL,
      headerSection: [
        { type: "header", name: "Authorization", value: "Basic myUser:secret" },
      ],
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content.authorization).toBe(
        `Basic ${Buffer.from("myUser:secret", "utf8").toString("base64")}`,
      );
    }
  }
});

test("doRequestFromBlock: keeps Authorization Basic base64 as-is", async () => {
  const already = Buffer.from("myUser:secret", "utf8").toString("base64");
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/auth` as KulalaHttpURL,
      headerSection: [
        { type: "header", name: "Authorization", value: `Basic ${already}` },
      ],
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content.authorization).toBe(`Basic ${already}`);
    }
  }
});

test("doRequestFromBlock: keeps Authorization Bearer as-is", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/auth` as KulalaHttpURL,
      headerSection: [
        {
          type: "header",
          name: "Authorization",
          value: "Bearer token123",
        },
      ],
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content.authorization).toBe("Bearer token123");
    }
  }
});

test("doRequestFromBlock: sends JSON body for POST with Content-Type application/json", async () => {
  const block = makeBlock({
    request: {
      method: "POST",
      url: `${baseUrl}/post` as KulalaHttpURL,
      headerSection: [
        {
          type: "header",
          name: "Content-Type",
          value: "application/json",
        },
      ],
      body: { key: "value", nested: { a: 1 } },
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content).toEqual({ received: true });
    }
  }
});

test("doRequestFromBlock: GRAPHQL sends as POST with query and variables", async () => {
  const block = makeBlock({
    request: {
      method: "GRAPHQL",
      url: `${baseUrl}/graphql` as KulalaHttpURL,
      headerSection: [],
      body: {
        query: "query { user { name } }",
        variables: { id: "1" },
      },
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content).toEqual({ data: {} });
    }
  }
});

test("doRequestFromBlock: GRAPHQL sends as POST with query only", async () => {
  const block = makeBlock({
    request: {
      method: "GRAPHQL",
      url: `${baseUrl}/graphql` as KulalaHttpURL,
      headerSection: [],
      body: {
        query: "query { viewer { id } }",
      },
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content).toEqual({ data: {} });
    }
  }
});

test("doRequestFromBlock: returns error response when got fails (connection refused)", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: "http://127.0.0.1:1/get",
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", false);
  if (!result.success && "error" in result) {
    expect(result.error.length).toBeGreaterThan(0);
  }
});

test("doRequestFromBlock: maps text response body when Content-Type is not json", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/text` as KulalaHttpURL,
      headerSection: [],
    },
  });

  const result = await doRequestFromBlock(
    block,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.body.type).toBe("text");
    if (result.body.type === "text") {
      expect(result.body.content).toBe("plain text response");
    }
  }
});

test("doRequestFromBlock: reads request body from file (JetBrains < path syntax)", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const dir = mkdtempSync(join(tmpdir(), "kulala-body-"));
  const bodyFile = join(dir, "input.json");
  await Bun.write(bodyFile, JSON.stringify({ from: "file", n: 42 }));
  const httpFilePath = join(dir, "request.http");

  const block = makeBlock({
    request: {
      method: "POST",
      url: `${baseUrl}/echo-body` as KulalaHttpURL,
      headerSection: [
        { type: "header", name: "Content-Type", value: "application/json" },
      ],
      body: { __bodyFromFile: "input.json" },
    },
  });

  const result = await doRequestFromBlock(
    block,
    httpFilePath,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  if (
    result.success &&
    result.body.type === "json" &&
    "content" in result.body
  ) {
    const content = result.body.content as { echoed?: string };
    expect(content.echoed).toBe(JSON.stringify({ from: "file", n: 42 }));
  }
});

test("doRequestFromBlock: redirects response to file (>>! overwrite)", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const fs = await import("fs/promises");
  const dir = mkdtempSync(join(tmpdir(), "kulala-redirect-"));
  const httpFilePath = join(dir, "request.http");
  const outFile = join(dir, "response.json");

  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/get` as KulalaHttpURL,
      headerSection: [],
      responseRedirect: { filePath: "response.json", overwrite: true },
    },
  });

  const result = await doRequestFromBlock(
    block,
    httpFilePath,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  const content = await fs.readFile(outFile, "utf-8");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  expect(parsed.json).toBeDefined();
  expect((parsed.json as Record<string, unknown>)?.success).toBe(true);
});

test("doRequestFromBlock: redirects response to file (>> create with suffix if exists)", async () => {
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const fs = await import("fs/promises");
  const dir = mkdtempSync(join(tmpdir(), "kulala-redirect2-"));
  const httpFilePath = join(dir, "request.http");
  const existingFile = join(dir, "out.json");
  await fs.writeFile(existingFile, "existing", "utf-8");

  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/text` as KulalaHttpURL,
      headerSection: [],
      responseRedirect: { filePath: "out.json", overwrite: false },
    },
  });

  const result = await doRequestFromBlock(
    block,
    httpFilePath,
    undefined,
    undefined,
    undefined,
  );

  expect(result).toHaveProperty("success", true);
  expect(await fs.readFile(existingFile, "utf-8")).toBe("existing");
  const newFile = join(dir, "out-1.json");
  expect(await fs.readFile(newFile, "utf-8")).toBe("plain text response");
});
