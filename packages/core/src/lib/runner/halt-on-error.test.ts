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

function twoBlockContent(): string {
  return `### First

GET ${baseUrl}/get HTTP/1.1

> {%
  client.test("fail", function() {
    client.assert(false, "first block fails");
  });
%}

### Second

GET ${baseUrl}/get HTTP/1.1
`;
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ ok: true });
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

test("runDocument: runs all blocks by default when haltOnError is omitted", async () => {
  const doc = await getDocument(twoBlockContent(), "/tmp/halt.http");
  const res = await runDocument(doc);

  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(2);
  expect(res.data[0]?.success).toBe(false);
  expect(res.data[1]?.success).toBe(true);
});

test("runDocument: haltOnError stops after the first failing block", async () => {
  const doc = await getDocument(twoBlockContent(), "/tmp/halt.http");
  const res = await runDocument(doc, undefined, { haltOnError: true });

  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(1);
  expect(res.data[0]?.success).toBe(false);
  expect(res.data[0]?.blockName).toBe("First");
});

test("runDocument: haltOnError false runs all blocks even after a failure", async () => {
  const doc = await getDocument(twoBlockContent(), "/tmp/halt.http");
  const res = await runDocument(doc, undefined, { haltOnError: false });

  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(2);
});
