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
import { doRequestFromBlock, type DoRequestFromBlockResult } from "./doRequest";
import type {
  KulalaPromptResponse,
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
} from "./types";

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
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";
import { setDbForTesting, getDbInMemory, closeDb } from "../persistence";

let testDir: string;
let server: ReturnType<typeof Bun.serve>;
let tokenUrl: string;
let apiUrl: string;

beforeAll(() => {
  // Set test environment to prevent browser opening
  process.env.NODE_ENV = "test";

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

      // Protected API endpoint (supports both GET and POST)
      if (
        path === "/api/protected" &&
        (req.method === "GET" || req.method === "POST")
      ) {
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
  if (server.port === undefined) {
    throw new Error("Test server did not expose a listening port");
  }
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
      url: apiUrl as KulalaHttpURL,
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

  const result = await httpDoRequestFromBlock(
    block,
    join(testDir, "test.http"),
    undefined,
    undefined,
    undefined,
    "default",
  );

  if (!result.success) {
    if ("error" in result) {
      console.log("Request failed with error:", result.error);
    }
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

test("doRequestFromBlock: handles escaped braces in $auth.token() from JSON payload", async () => {
  // Create OAuth2 config
  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "playground-oauth2": {
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

  // Simulate the scenario where braces are escaped in JSON: \\{\\{$auth.token(...)\\}\\}
  const block: KulalaBlock = {
    name: "GET_DATA_WITH_SCOPES",
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "POST",
      url: apiUrl as KulalaHttpURL,
      headerSection: [
        {
          type: "header",
          name: "Authorization",
          // This simulates what happens when JSON escapes braces: \\{\\{$auth.token("playground-oauth2")\\}\\}
          // After JSON parsing, this becomes: \{\{$auth.token("playground-oauth2")\}\}
          value: 'Bearer \\{\\{$auth.token("playground-oauth2")\\}\\}',
        },
        {
          type: "header",
          name: "Accept",
          value: "application/json",
        },
      ],
    },
    scripts: { preRequest: [], postRequest: [] },
    position: { start: 1, end: 10 },
  };

  const result = await httpDoRequestFromBlock(
    block,
    join(testDir, "oauth2.http"),
    undefined,
    undefined,
    undefined,
    "default",
  );

  if (!result.success) {
    if ("prompt" in result && result.prompt) {
      const prompt = result as unknown as KulalaPromptResponse;
      console.log("Got prompt response:", JSON.stringify(prompt, null, 2));
      throw new Error(
        `Unexpected prompt response: ${prompt.message}. This test should use Client Credentials which doesn't require prompts.`,
      );
    } else if ("error" in result) {
      console.log("Request failed with error:", result.error);
      console.log("Full result:", JSON.stringify(result, null, 2));
      console.log("Block URL:", block.request.url);
      console.log(
        "Block headers:",
        JSON.stringify(block.request.headerSection, null, 2),
      );
    } else {
      console.log("Unknown error format:", JSON.stringify(result, null, 2));
    }
  }
  expect(result).toHaveProperty("success", true);
  if (result.success) {
    expect(result.status).toBe(200);
    // The Authorization header should have the actual token, not the placeholder
    expect(result.body.type).toBe("json");
  }
});
