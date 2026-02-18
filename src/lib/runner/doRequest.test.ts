import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import type { KulalaBlock } from "../parser/types/block";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import { doRequestFromBlock } from "./doRequest";

let server: { stop: () => void; port: number };
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
      url: `${baseUrl}/get`,
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
        return Response.json({});
      }
      if (path === "/post" && method === "POST") {
        return Response.json({ received: true });
      }
      if (path === "/graphql" && method === "POST") {
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
    expect(result.timings).toHaveProperty("request");
    expect(result.timings).toHaveProperty("tls");
    expect(result.timings).toHaveProperty("redirect");
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

test("doRequestFromBlock: encodes Authorization Basic username:password", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/auth`,
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
      url: `${baseUrl}/auth`,
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
      url: `${baseUrl}/auth`,
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
      url: `${baseUrl}/post`,
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
      url: `${baseUrl}/graphql`,
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
  if (!result.success) {
    expect(result.error.length).toBeGreaterThan(0);
  }
});

test("doRequestFromBlock: maps text response body when Content-Type is not json", async () => {
  const block = makeBlock({
    request: {
      method: "GET",
      url: `${baseUrl}/text`,
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
