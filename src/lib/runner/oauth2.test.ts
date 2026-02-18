import {
  expect,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { doRequestFromBlock } from "./doRequest";
import type { KulalaBlock } from "../parser/types/block";
import { setDbForTesting, getDbInMemory, closeDb } from "../persistence";

let testDir: string;
let server: { stop: () => void; port: number };
let tokenUrl: string;
let apiUrl: string;

beforeAll(() => {
  testDir = join(process.cwd(), ".test-oauth2-integration");
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }

  // Start mock OAuth2 token server and API server
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // OAuth2 token endpoint
      if (path === "/token" && req.method === "POST") {
        const body = await req.text();
        const params = new URLSearchParams(body);
        const authHeader = req.headers.get("authorization");

        if (authHeader?.startsWith("Basic ")) {
          const decoded = Buffer.from(authHeader.slice(6), "base64").toString(
            "utf8",
          );
          const [clientId, clientSecret] = decoded.split(":");
          if (
            clientId === "test-client-id" &&
            clientSecret === "test-client-secret"
          ) {
            return Response.json({
              access_token: "test-access-token-123",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
        }
        return new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Protected API endpoint
      if (path === "/api/protected" && req.method === "GET") {
        const authHeader = req.headers.get("authorization");
        if (authHeader === "Bearer test-access-token-123") {
          return Response.json({
            message: "Success",
            data: "protected resource",
          });
        }
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  tokenUrl = `http://localhost:${server.port}/token`;
  apiUrl = `http://localhost:${server.port}/api/protected`;
});

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

afterAll(() => {
  server.stop();
  // Clean up test files
  try {
    const envFile = join(testDir, "http-client.env.json");
    const privateFile = join(testDir, "http-client.private.env.json");
    if (existsSync(envFile)) unlinkSync(envFile);
    if (existsSync(privateFile)) unlinkSync(privateFile);
  } catch {
    // ignore
  }
});

test("doRequestFromBlock: uses OAuth2 token from $auth.token()", async () => {
  // Create OAuth2 config
  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "my-oauth": {
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

  const block: KulalaBlock = {
    name: "PROTECTED_REQUEST",
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: apiUrl,
      headerSection: [
        {
          type: "header",
          name: "Authorization",
          value: 'Bearer {{$auth.token("my-oauth")}}',
        },
      ],
    },
    scripts: { preRequest: [], postRequest: [] },
    position: { start: 1, end: 10 },
  };

  const result = await doRequestFromBlock(
    block,
    join(testDir, "test.http"),
    undefined,
    undefined,
    undefined,
    "default",
  );

  if (!result.success) {
    console.log("Request failed with error:", result.error);
    console.log("Block URL:", block.request.url);
    console.log(
      "Block headers:",
      JSON.stringify(block.request.headerSection, null, 2),
    );
  }
  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.status).toBe(200);
    expect(result.body.type).toBe("json");
    if (result.body.type === "json") {
      expect(result.body.content.message).toBe("Success");
    }
  }
});
