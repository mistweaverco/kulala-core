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
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      const path = u.pathname;
      const method = req.method;
      if (path === "/get" && method === "GET") {
        return Response.json({ json: { success: true, url: baseUrl } });
      }
      if (path === "/path" && method === "GET") {
        return Response.json({});
      }
      if (path === "/post" && method === "POST") {
        return Response.json({ received: true });
      }
      if (path === "/graphql" && method === "POST") {
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
    expect(result.timings).toHaveProperty("namelookup");
    expect(result.timings).toHaveProperty("connect");
    expect(result.timings).toHaveProperty("starttransfer");
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
