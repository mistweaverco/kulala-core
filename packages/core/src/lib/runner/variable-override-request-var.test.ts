import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDocument } from "../parser/parser";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import { runDocument } from "./index";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const testDir = join(tmpdir(), `kulala-var-override-${Date.now()}`);

beforeAll(() => {
  mkdirSync(testDir, { recursive: true });
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const id = url.searchParams.get("id") ?? "missing";
      return Response.json({ echoedId: id, path: url.pathname });
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

test("runDocument: variable override resolves request variable references", async () => {
  const importedFile = join(testDir, "imported.http");
  writeFileSync(
    importedFile,
    `### LIST_ITEMS
GET ${baseUrl}/list HTTP/1.1
Accept: application/json

### USE_ITEM
GET ${baseUrl}/item?id={{someVar}} HTTP/1.1
Accept: application/json
`,
  );

  const mainFile = join(testDir, "main.http");
  const mainContent = `# @kulala-vscode-restclient-compat
import ${importedFile}

### GET_LIST

run #LIST_ITEMS

### SECOND_REQ

run #USE_ITEM (@someVar={{GET_LIST.response.body.$.echoedId}})
`;
  writeFileSync(mainFile, mainContent);

  const doc = await getDocument(mainContent, mainFile);
  const res = await runDocument(doc);

  expect(res.type).toBe("responses");
  const second = res.data.find(
    (item) => "blockName" in item && item.blockName === "SECOND_REQ",
  );
  expect(second).toBeDefined();
  expect(second!.success).toBe(true);
  if (!second!.success || !("url" in second!)) {
    throw new Error("expected successful HTTP response");
  }
  expect(second!.url).toContain("id=missing");
});
