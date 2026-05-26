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
