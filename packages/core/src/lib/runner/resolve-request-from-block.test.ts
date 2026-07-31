import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { getDocument } from "../parser/parser";
import { findBlockAtCursor } from "./block";
import { resolveRequestFromBlock } from "./resolve-request-from-block";
import { toCurlAtCursor } from "./request-cursor";

const implicitFirstRequestPath = join(
  import.meta.dir,
  "../../../../../http-example-files/implicit-first-request.http",
);
const omitReqUrlHostPath = join(
  import.meta.dir,
  "../../../../../http-example-files/omit-req-url-but-set-host.http",
);
const grpcExamplePath = join(
  import.meta.dir,
  "../../../../../http-example-files/grpc.http",
);
const websocketExamplePath = join(
  import.meta.dir,
  "../../../../../http-example-files/websocket.http",
);

const operatorsExamplePath = join(
  import.meta.dir,
  "../../../../../http-example-files/operators.http",
);

const graphqlContent = `### GQL_TEST

GRAPHQL https://example.com/graphql HTTP/1.1
Accept: application/json

query { foo }

`;

describe("resolveRequestFromBlock", () => {
  test("omit-req-url-but-set-host: bare hostname in Host header", async () => {
    const content = readFileSync(omitReqUrlHostPath, "utf8");
    const doc = await getDocument(content, omitReqUrlHostPath);
    const block = doc.blocks[0];
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      omitReqUrlHostPath,
      block!.preambleVariables,
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.url).toBe("http://echo.kulala.app/get");
    expect(result.request.headers.Host).toBe("echo.kulala.app");
  });

  test("omit-req-url-but-set-host: full URL in Host header keeps scheme", async () => {
    const content = readFileSync(omitReqUrlHostPath, "utf8");
    const doc = await getDocument(content, omitReqUrlHostPath);
    const block = doc.blocks[1];
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      omitReqUrlHostPath,
      block!.preambleVariables,
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.url).toBe("https://echo.kulala.app/get");
    expect(result.request.headers.Host).toBe("echo.kulala.app");
  });

  test("adds Content-Type application/json for GRAPHQL", async () => {
    const doc = await getDocument(graphqlContent, "/test.http");
    const block = findBlockAtCursor(doc, { line: 5, column: 1 });
    expect(block).not.toBeNull();

    const result = await resolveRequestFromBlock(
      block!,
      undefined,
      {},
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.method).toBe("POST");
    expect(result.request.headers["Content-Type"]).toBe("application/json");
    expect(result.request.body).toContain("query");
  });

  test("cursor on pre-request script resolves implicit first request", async () => {
    const content = `< {%
  request.variables.set("users", [
    { name: "Alice" },
    { name: "Bob" },
  ])
%}

GET https://echo.kulala.app/get?user={{users[*].name}} HTTP/1.1
Content-Type: application/json`;
    const doc = await getDocument(content, "/test.http");

    expect(doc.blocks[0]?.position).toEqual({ start: 1, end: 9 });
    expect(doc.blocks[0]?.scripts.preRequest).toHaveLength(1);
    expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 6, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 8, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
  });

  test("cursor on doc-scoped variables resolves implicit first request", async () => {
    const content = `@MY_VAR = 123
# @kulala-curl--insecure

< {%
  request.variables.set("users", [
    { name: "Alice" },
    { name: "Bob" },
  ])
%}

GET https://echo.kulala.app/get?user={{users[*].name}} HTTP/1.1
Content-Type: application/json`;
    const doc = await getDocument(content, "/test.http");

    expect(doc.blocks[0]?.position).toEqual({ start: 1, end: 12 });
    expect(doc.blocks[0]?.contentStartLine).toBe(4);
    expect(doc.blocks[0]?.scripts.preRequest).toHaveLength(1);
    expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 6, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 8, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
  });

  test("cursor on file-header lines resolves implicit-first-request.http", async () => {
    const content = `@MY_VAR = 123
# @kulala-curl--insecure

< {%
  request.variables.set("users", [
    { name: "Alice" },
    { name: "Bob" },
  ])
%}

GET https://echo.kulala.app/get?user={{users[*].name}} HTTP/1.1
Content-Type: application/json

### FOO

GET https://echo.kulala.app/get?var={{MY_VAR}} HTTP/1.1`;
    const doc = await getDocument(content, implicitFirstRequestPath);

    expect(doc.blocks[0]?.position).toEqual({ start: 1, end: 13 });
    expect(doc.blocks[0]?.contentStartLine).toBe(4);
    expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 2, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 11, column: 1 })?.name).toBe(
      "REQUEST_001",
    );
    expect(findBlockAtCursor(doc, { line: 14, column: 1 })?.name).toBe("FOO");
  });
});

describe("toCurlAtCursor", () => {
  test("includes JSON body without Content-Type header", async () => {
    const content = `### POST_JSON_NO_CT
POST https://example.com/post HTTP/1.1

{
  "foo": "bar"
}`;
    const result = await toCurlAtCursor({
      content,
      filepath: "/test.http",
      line: 2,
      column: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain('{"foo":"bar"}');
    expect(result.curl).toContain("Content-Type;");
    expect(result.curl).not.toContain("application/json");
  });

  test("includes Content-Type for GRAPHQL requests", async () => {
    const result = await toCurlAtCursor({
      content: graphqlContent,
      filepath: "/test.http",
      line: 5,
      column: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("Content-Type");
    expect(result.curl).toContain("application/json");
    expect(result.curl).toContain("-X");
    expect(result.curl).toContain("POST");
  });

  test("formats GRPC requests as grpcurl", async () => {
    const content = readFileSync(grpcExamplePath, "utf8");
    const result = await toCurlAtCursor({
      content,
      filepath: grpcExamplePath,
      line: 6,
      column: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("grpcurl");
    expect(result.curl).toContain("-d");
    expect(result.curl).toContain("echo.Echo/UnaryEcho");
    expect(result.curl).toContain("Hello world!");
  });

  test("substitutes variables in GRPC target", async () => {
    const content = readFileSync(grpcExamplePath, "utf8");
    const doc = await getDocument(content, grpcExamplePath);
    const block = doc.blocks.find((b) => b.name === "POSTMAN_GRPC_ECHO");
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      grpcExamplePath,
      {
        "grpc.addr": "grpc.postman-echo.com",
        "grpc.port": "443",
      },
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "grpc") return;

    expect(result.request.grpcCommand.address).toBe(
      "grpc.postman-echo.com:443",
    );
    expect(result.request.grpcCommand.symbol).toBe("HelloService/SayHello");
  });

  test("substitutes file-header @ variables in GRPC target", async () => {
    const content = readFileSync(grpcExamplePath, "utf8");
    const result = await toCurlAtCursor({
      content,
      filepath: grpcExamplePath,
      line: 26,
      column: 1,
      env: "default",
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("grpc.postman-echo.com:443");
    expect(result.curl).toContain("HelloService/SayHello");
    expect(result.curl).not.toContain("{{");
  });

  test("formats WEBSOCKET requests as websocat", async () => {
    const content = readFileSync(websocketExamplePath, "utf8");
    const result = await toCurlAtCursor({
      content,
      filepath: websocketExamplePath,
      line: 3,
      column: 1,
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("websocat");
    expect(result.curl).toContain("wss://echo.kulala.app");
    expect(result.curl).toContain('"message":"Hello world!"');
  });

  test("substitutes variables in WEBSOCKET target", async () => {
    const content = `@WS_URL = wss://echo.kulala.app

### WS_TEST

WEBSOCKET {{ WS_URL }}

{"name": "world"}
`;
    const doc = await getDocument(content, "/test.http");
    const block = doc.blocks.find((b) => b.name === "WS_TEST");
    expect(block).toBeDefined();
    expect(block!.request.url).toBe("{{ WS_URL }}");

    const result = await resolveRequestFromBlock(
      block!,
      "/test.http",
      { WS_URL: "wss://echo.kulala.app" },
      undefined,
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "websocket") return;

    expect(result.request.url).toBe("wss://echo.kulala.app");
  });

  test("substitutes env variables in WEBSOCKET target from websocket.http", async () => {
    const content = readFileSync(websocketExamplePath, "utf8");
    const result = await toCurlAtCursor({
      content,
      filepath: websocketExamplePath,
      line: 3,
      column: 1,
      env: "default",
    });
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;

    expect(result.curl).toContain("wss://echo.kulala.app/ws");
    expect(result.curl).not.toContain("{{");
  });
});

describe("resolveRequestFromBlock OAuth preview", () => {
  let testDir: string;
  let server: ReturnType<typeof Bun.serve>;
  let tokenUrl: string;
  let tokenRequests = 0;

  beforeAll(() => {
    testDir = join(process.cwd(), ".test-resolve-oauth-preview");
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/token" && req.method === "POST") {
          tokenRequests += 1;
          return Response.json({
            access_token: "should-not-be-used",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    if (server.port === undefined) {
      throw new Error("Test server did not expose a listening port");
    }
    tokenUrl = `http://localhost:${server.port}/token`;
  });

  afterAll(() => {
    server.stop();
    try {
      for (const name of [
        "http-client.env.json",
        "http-client.private.env.json",
      ]) {
        const file = join(testDir, name);
        if (existsSync(file)) unlinkSync(file);
      }
    } catch {
      // ignore
    }
  });

  test("does not acquire OAuth tokens when resolving request preview", async () => {
    tokenRequests = 0;
    writeFileSync(
      join(testDir, "http-client.env.json"),
      JSON.stringify(
        {
          default: {
            Security: {
              Auth: {
                "preview-auth": {
                  Type: "OAuth2",
                  "Grant Type": "Client Credentials",
                  "Token URL": tokenUrl,
                  "Client ID": "test-client-id",
                  "Client Secret": "test-client-secret",
                  "Client Credentials": "basic",
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const httpFile = join(testDir, "oauth-preview.http");
    const content = `### OAuth preview

GET https://example.com/api HTTP/1.1
Authorization: Bearer {{$auth.token("preview-auth")}}

`;
    writeFileSync(httpFile, content);

    const doc = await getDocument(content, httpFile);
    const block = doc.blocks[0];
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      httpFile,
      {},
      undefined,
      "default",
    );
    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.headers.Authorization).toBe("Bearer ");
    expect(tokenRequests).toBe(0);
    expect(existsSync(join(testDir, "http-client.private.env.json"))).toBe(
      false,
    );
  });

  test("encodes query parameters in URL by default", async () => {
    const content = `### ENCODE_QUERY

GET https://example.com/get?
  name=@#$somebody&
  qwerty=%40%23%24
  HTTP/1.1

`;
    const httpFile = join(import.meta.dir, "encode-query-default.http");
    writeFileSync(httpFile, content);
    const doc = await getDocument(content, httpFile);
    const block = doc.blocks[0];
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      httpFile,
      {},
      undefined,
      "default",
    );
    unlinkSync(httpFile);

    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.url).toBe(
      "https://example.com/get?name=%40%23%24somebody&qwerty=%40%23%24",
    );
  });

  test("operators.http NO_AUTO_ENCODING_REQUEST preserves URL without encoding", async () => {
    const content = readFileSync(operatorsExamplePath, "utf8");
    const doc = await getDocument(content, operatorsExamplePath);
    const block = doc.blocks.find((b) => b.name === "NO_AUTO_ENCODING_REQUEST");
    expect(block).toBeDefined();

    const result = await resolveRequestFromBlock(
      block!,
      operatorsExamplePath,
      block!.preambleVariables,
      undefined,
      "default",
    );

    expect(result).toMatchObject({ ok: true });
    if (!("ok" in result) || !result.ok) return;
    if (result.request.kind !== "http") return;

    expect(result.request.url).toBe(
      "https://echo.kulala.app/get?name=@#$somebody&qwerty=%40%23%24",
    );
  });
});
