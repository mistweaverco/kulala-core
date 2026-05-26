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
      const url = new URL(req.url);
      return Response.json({ path: url.pathname, query: url.search });
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

test("runDocument: KULALA_SHARED HTTP runs before a single named request", async () => {
  const content = `### KULALA_SHARED

< {%
  request.variables.set("token", "from-script");
%}

GET ${baseUrl}/shared-setup?token={{token}} HTTP/1.1

### FOO1

GET ${baseUrl}/foo HTTP/1.1
`;
  const doc = await getDocument(content, "/tmp/shared-block-http.http");
  const res = await runDocument(doc, [{ filter: "name", name: "FOO1" }]);

  expect(res.type).toBe("responses");
  expect(res.data.length).toBeGreaterThanOrEqual(2);

  const shared = res.data.find(
    (r) => "blockName" in r && r.blockName === "KULALA_SHARED",
  );
  const foo = res.data.find((r) => "blockName" in r && r.blockName === "FOO1");
  expect(shared).toBeDefined();
  expect(foo).toBeDefined();
  expect(shared?.success).toBe(true);
  if (shared?.success && "body" in shared && shared.body.type === "json") {
    expect(shared.body.content.query).toContain("token=from-script");
  }
});
