import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getDocument } from "../parser/parser";
import { findBlockForRunRequest } from "./find-block-for-run-request";
import { doRequestFromBlock, type DoRequestFromBlockResult } from "./doRequest";
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
} from "./types";
import type { VariableResolver } from "./types";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { MAX_RUN_REQUEST_DEPTH } from "./run-request-from-script";
import { createRequestVarContext } from "./request-var-context";
import type { ScriptFlowContext } from "./scripts";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let tempDir: string;

type HttpDoRequestResult =
  | KulalaRequestSuccessResponse
  | KulalaRequestErrorResponse;

function unwrapHttpDoRequestResult(
  result: DoRequestFromBlockResult | DoRequestFromBlockResult[],
): HttpDoRequestResult {
  const r = Array.isArray(result) ? result[0]! : result;
  if ("protocol" in r) {
    throw new Error("expected HTTP result, got websocket plan");
  }
  if ("prompt" in r) {
    throw new Error("expected HTTP result, got prompt");
  }
  if ("skipped" in r) {
    throw new Error("expected HTTP result, got skipped");
  }
  return r;
}

async function httpDoRequestFromBlock(
  ...args: Parameters<typeof doRequestFromBlock>
): Promise<HttpDoRequestResult> {
  return unwrapHttpDoRequestResult(await doRequestFromBlock(...args));
}

function makeFlow(
  doc: KulalaDocument,
  block: KulalaBlock,
): { flow: ScriptFlowContext; resolver: VariableResolver | undefined } {
  const { previousResults, resolver } = createRequestVarContext(
    doc,
    block,
    doc.filepath ?? "",
  );
  return {
    flow: {
      globalHeaders: {},
      requestVarResults: previousResults,
    },
    resolver,
  };
}

beforeAll(() => {
  process.env.NODE_ENV = "test";
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/token" && req.method === "POST") {
        return Response.json({ access_token: "secret-token-123" });
      }
      if (u.pathname === "/auth" && req.method === "GET") {
        return Response.json({
          authorization: req.headers.get("authorization"),
        });
      }
      if (u.pathname === "/echo-global" && req.method === "GET") {
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
  tempDir = mkdtempSync(join(tmpdir(), "kulala-run-request-"));
});

afterAll(() => {
  server.stop();
  closeDb();
});

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

describe("findBlockForRunRequest", () => {
  test("finds native block by ### name", async () => {
    const doc = await getDocument(
      `### Login\nGET ${baseUrl}/token HTTP/1.1`,
      join(tempDir, "native.http"),
    );
    const found = await findBlockForRunRequest(doc, "Login", doc.filepath);
    expect(found.block.name).toBe("Login");
    expect(found.filePath).toBe(doc.filepath);
  });

  test("prefers imported block over native duplicate name", async () => {
    const importedPath = join(tempDir, "imported-login.http");
    writeFileSync(importedPath, `### Login\nGET ${baseUrl}/token HTTP/1.1`);
    const doc = await getDocument(
      `import ./imported-login.http\n\n### Login\nGET ${baseUrl}/auth HTTP/1.1`,
      join(tempDir, "with-import.http"),
    );
    const found = await findBlockForRunRequest(doc, "Login", doc.filepath);
    expect(found.filePath).toBe(importedPath);
  });

  test("loads block from external filePath argument", async () => {
    const externalPath = join(tempDir, "external.http");
    writeFileSync(
      externalPath,
      `### ExternalLogin\nPOST ${baseUrl}/token HTTP/1.1`,
    );
    const doc = await getDocument(
      `### Main\nGET ${baseUrl}/auth HTTP/1.1`,
      join(tempDir, "main.http"),
    );
    const found = await findBlockForRunRequest(
      doc,
      "ExternalLogin",
      doc.filepath,
      "./external.http",
    );
    expect(found.block.name).toBe("ExternalLogin");
    expect(found.filePath).toBe(externalPath);
  });

  test("throws when block is not found", async () => {
    const doc = await getDocument(
      `### Only\nGET ${baseUrl}/auth HTTP/1.1`,
      join(tempDir, "missing.http"),
    );
    await expect(
      findBlockForRunRequest(doc, "Missing", doc.filepath),
    ).rejects.toThrow(/block not found: Missing/);
  });
});

describe("$kulala.runRequest via doRequestFromBlock", () => {
  test("pre-request runRequest sets auth header on parent request", async () => {
    const loginPath = join(tempDir, "chain-login.http");
    writeFileSync(
      loginPath,
      `### Login\nPOST ${baseUrl}/token HTTP/1.1\nContent-Type: application/json\n\n{}`,
    );
    const mainPath = join(tempDir, "chain-main.http");
    writeFileSync(
      mainPath,
      `import ./chain-login.http\n\n### Protected\n< {%\n  const res = await $kulala.runRequest("Login");\n  client.global.set("authToken", res.body.access_token);\n%}\nGET ${baseUrl}/auth HTTP/1.1\nAuthorization: Bearer {{authToken}}`,
    );
    const doc = await getDocument(await Bun.file(mainPath).text(), mainPath);
    const block = doc.blocks.find((b) => b.name === "Protected");
    expect(block).toBeDefined();
    const { flow, resolver } = makeFlow(doc, block!);
    const result = await httpDoRequestFromBlock(
      block!,
      mainPath,
      {},
      mainPath,
      resolver,
      "default",
      flow,
      { doc },
    );
    expect(result).toHaveProperty("success", true);
    if (!result.success || !("body" in result)) return;
    if (result.body.type === "json") {
      expect(result.body.content.authorization).toBe("Bearer secret-token-123");
    }
  });

  test("sub-request client.global.set is visible to parent script vars", async () => {
    const helperPath = join(tempDir, "helper.http");
    writeFileSync(
      helperPath,
      `### SetGlobal\n< {%\n  client.global.set("FROM_SUB", "sub-value");\n%}\nGET ${baseUrl}/echo-global HTTP/1.1`,
    );
    const mainPath = join(tempDir, "parent-global.http");
    writeFileSync(
      mainPath,
      `### Parent\n< {%\n  await $kulala.runRequest("SetGlobal", "./helper.http");\n  request.variables.set("ECHO", client.global.get("FROM_SUB"));\n%}\nGET ${baseUrl}/auth?echo={{ECHO}} HTTP/1.1`,
    );
    const doc = await getDocument(await Bun.file(mainPath).text(), mainPath);
    const block = doc.blocks.find((b) => b.name === "Parent");
    const { flow, resolver } = makeFlow(doc, block!);
    const result = await httpDoRequestFromBlock(
      block!,
      mainPath,
      {},
      mainPath,
      resolver,
      "default",
      flow,
      { doc },
    );
    expect(result).toHaveProperty("success", true);
    if (!result.success || !("url" in result)) return;
    expect(result.url).toContain("echo=sub-value");
  });

  test("records response for {{Block.response...}} templates", async () => {
    const loginPath = join(tempDir, "vars-login.http");
    writeFileSync(
      loginPath,
      `### Login\nPOST ${baseUrl}/token HTTP/1.1\nContent-Type: application/json\n\n{}`,
    );
    const mainPath = join(tempDir, "vars-main.http");
    writeFileSync(
      mainPath,
      `# @kulala-vscode-restclient-compat\nimport ./vars-login.http\n\n### UseToken\n< {% await $kulala.runRequest("Login"); %}\nGET ${baseUrl}/auth HTTP/1.1\nAuthorization: Bearer {{Login.response.body.$.access_token}}`,
    );
    const doc = await getDocument(await Bun.file(mainPath).text(), mainPath);
    const block = doc.blocks.find((b) => b.name === "UseToken");
    const { flow, resolver } = makeFlow(doc, block!);
    const result = await httpDoRequestFromBlock(
      block!,
      mainPath,
      {},
      mainPath,
      resolver,
      "default",
      flow,
      { doc },
    );
    expect(result).toHaveProperty("success", true);
    if (!result.success || !("body" in result)) return;
    if (result.body.type === "json") {
      expect(result.body.content.authorization).toBe("Bearer secret-token-123");
    }
  });

  test("detects circular runRequest chains", async () => {
    const mainPath = join(tempDir, "circular.http");
    writeFileSync(
      mainPath,
      `### A\n< {% await $kulala.runRequest("A"); %}\nGET ${baseUrl}/auth HTTP/1.1`,
    );
    const doc = await getDocument(await Bun.file(mainPath).text(), mainPath);
    const block = doc.blocks.find((b) => b.name === "A");
    const { flow, resolver } = makeFlow(doc, block!);
    const result = await httpDoRequestFromBlock(
      block!,
      mainPath,
      {},
      mainPath,
      resolver,
      "default",
      flow,
      { doc },
    );
    expect(result).toHaveProperty("success", false);
    if (result.success) return;
    expect(result.error).toMatch(/circular request chain/i);
  });

  test("enforces max runRequest nesting depth", async () => {
    const chainDir = join(tempDir, "deep-chain");
    mkdirSync(chainDir, { recursive: true });
    const blocks: string[] = [];
    for (let i = 0; i <= MAX_RUN_REQUEST_DEPTH + 1; i++) {
      const name = `Step${i}`;
      const next =
        i < MAX_RUN_REQUEST_DEPTH + 1
          ? `< {% await $kulala.runRequest("Step${i + 1}"); %}\n`
          : "";
      blocks.push(`### ${name}\n${next}GET ${baseUrl}/echo-global HTTP/1.1`);
    }
    const mainPath = join(chainDir, "deep.http");
    writeFileSync(mainPath, blocks.join("\n\n"));
    const doc = await getDocument(await Bun.file(mainPath).text(), mainPath);
    const block = doc.blocks.find((b) => b.name === "Step0");
    const { flow, resolver } = makeFlow(doc, block!);
    const result = await httpDoRequestFromBlock(
      block!,
      mainPath,
      {},
      mainPath,
      resolver,
      "default",
      flow,
      { doc },
    );
    expect(result).toHaveProperty("success", false);
    if (result.success) return;
    expect(result.error).toMatch(/max nesting depth/i);
  });
});
