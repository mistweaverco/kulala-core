import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { getDocument } from "../parser/parser";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import { runDocument } from "./index";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return Response.json({ headers });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
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

test("runDocument: client.global.headers.set in pre-request applies to subsequent blocks", async () => {
  const content = `### First

< {%
  client.global.headers.set("X-Kulala", "Family");
%}

GET ${baseUrl}/get HTTP/1.1

### Second

GET ${baseUrl}/get HTTP/1.1

### Third

GET ${baseUrl}/get HTTP/1.1
`;
  const doc = await getDocument(content, "/tmp/shared-headers.http");
  const res = await runDocument(doc);

  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(3);

  for (const item of res.data) {
    expect(item).toHaveProperty("success", true);
    if (!item.success || !("body" in item) || item.body.type !== "json") {
      continue;
    }
    const headers = item.body.content.headers as Record<string, string>;
    expect(headers["x-kulala"] ?? headers["X-Kulala"]).toBe("Family");
  }
});

test("$kulala.client.global.headers.set persists across runs", async () => {
  const content1 = `### First

< {%
  $kulala.client.global.headers.set("X-Kulala", "Family");
%}

GET ${baseUrl}/get HTTP/1.1
`;
  const content2 = `### Second

GET ${baseUrl}/get HTTP/1.1
`;
  const doc1 = await getDocument(
    content1,
    "/tmp/persisted-shared-headers-1.http",
  );
  const res1 = await runDocument(doc1);
  expect(res1.type).toBe("responses");
  expect(res1.data).toHaveLength(1);

  const doc2 = await getDocument(
    content2,
    "/tmp/persisted-shared-headers-2.http",
  );
  const res2 = await runDocument(doc2);
  expect(res2.type).toBe("responses");
  expect(res2.data).toHaveLength(1);

  const item = res2.data[0]!;
  expect(item).toHaveProperty("success", true);
  if (!item.success || !("body" in item) || item.body.type !== "json") return;
  const headers = item.body.content.headers as Record<string, string>;
  expect(headers["x-kulala"] ?? headers["X-Kulala"]).toBe("Family");
});

test("$kulala.client.global.headers.get returns persisted value", async () => {
  const content = `### First

< {%
  $kulala.client.global.headers.set("X-Kulala", "Family");
  client.assert($kulala.client.global.headers.get("x-kulala") === "Family");
  client.assert($kulala.client.global.headers.get("X-KULALA") === "Family");
  client.assert($kulala.client.global.headers.get("does-not-exist") === undefined);
%}

GET ${baseUrl}/get HTTP/1.1
`;
  const doc = await getDocument(
    content,
    "/tmp/persisted-shared-headers-get.http",
  );
  const res = await runDocument(doc);
  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(1);
  expect(res.data[0]).toHaveProperty("success", true);
});

test("Lua: _G['$kulala'] client.global.headers.set persists across runs", async () => {
  const content1 = `### First

< {% lang=lua
  _G["$kulala"].client.global.headers.set("X-Kulala", "Family")
%}

GET ${baseUrl}/get HTTP/1.1
`;
  const content2 = `### Second

GET ${baseUrl}/get HTTP/1.1
`;

  const doc1 = await getDocument(
    content1,
    "/tmp/persisted-shared-headers-lua-1.http",
  );
  const res1 = await runDocument(doc1);
  expect(res1.type).toBe("responses");
  expect(res1.data).toHaveLength(1);

  const doc2 = await getDocument(
    content2,
    "/tmp/persisted-shared-headers-lua-2.http",
  );
  const res2 = await runDocument(doc2);
  expect(res2.type).toBe("responses");
  expect(res2.data).toHaveLength(1);

  const item = res2.data[0]!;
  expect(item).toHaveProperty("success", true);
  if (!item.success || !("body" in item) || item.body.type !== "json") return;
  const headers = item.body.content.headers as Record<string, string>;
  expect(headers["x-kulala"] ?? headers["X-Kulala"]).toBe("Family");
});
