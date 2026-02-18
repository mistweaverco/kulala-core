import { expect, test, beforeAll, afterAll } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { OAuth2Manager } from "./manager";
import {
  acquireAuthorizationCodeToken,
  acquireClientCredentialsToken,
  acquireImplicitToken,
  acquirePasswordToken,
} from "./acquisition";
import { generatePKCE, generatePKCEPlain } from "./browser-flow";
import type { OAuth2Config } from "./types";

let testDir: string;
let server: { stop: () => void; port: number };
let tokenUrl: string;

beforeAll(() => {
  testDir = join(process.cwd(), ".test-oauth2");
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }

  // Start mock OAuth2 token server
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/token" && req.method === "POST") {
        const body = await req.text();
        const params = new URLSearchParams(body);

        // Verify grant_type
        if (params.get("grant_type") !== "client_credentials") {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Check for Basic auth or client_id/client_secret in body
        const authHeader = req.headers.get("authorization");
        let clientId: string | null = null;
        let clientSecret: string | null = null;

        if (authHeader?.startsWith("Basic ")) {
          const decoded = Buffer.from(authHeader.slice(6), "base64").toString(
            "utf8",
          );
          [clientId, clientSecret] = decoded.split(":");
        } else {
          clientId = params.get("client_id");
          clientSecret = params.get("client_secret");
        }

        if (!clientId || clientId !== "test-client-id") {
          return new Response(JSON.stringify({ error: "invalid_client" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (clientSecret !== "test-client-secret") {
          return new Response(JSON.stringify({ error: "invalid_client" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Return token
        return Response.json({
          access_token: "test-access-token-123",
          token_type: "Bearer",
          expires_in: 3600,
          scope: params.get("scope") || "read write",
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  tokenUrl = `http://localhost:${server.port}/token`;
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

test("OAuth2: Client Credentials with Basic auth", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Client Credentials",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
    "Client Secret": "test-client-secret",
    "Client Credentials": "basic",
  };

  const tokenData = await acquireClientCredentialsToken(config);
  expect(tokenData.access_token).toBe("test-access-token-123");
  expect(tokenData.token_type).toBe("Bearer");
  expect(tokenData.expires_in).toBe(3600);
  expect(tokenData.expires_at).toBeDefined();
});

test("OAuth2: Client Credentials with credentials in body", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Client Credentials",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
    "Client Secret": "test-client-secret",
    "Client Credentials": "in body",
  };

  const tokenData = await acquireClientCredentialsToken(config);
  expect(tokenData.access_token).toBe("test-access-token-123");
});

test("OAuth2: Manager loads config and acquires token", async () => {
  // Create http-client.env.json
  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "test-auth": {
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

  const manager = new OAuth2Manager("default", testDir);
  const token = await manager.getAccessToken("test-auth");
  expect(token).toBe("test-access-token-123");

  // Check that token was saved
  const privateFile = join(testDir, "http-client.private.env.json");
  expect(existsSync(privateFile)).toBe(true);
  const privateContent = await Bun.file(privateFile).text();
  const privateData = JSON.parse(privateContent);
  expect(privateData.default.auth_data["test-auth"]).toBeDefined();
  expect(privateData.default.auth_data["test-auth"].access_token).toBe(
    "test-access-token-123",
  );
});

test("OAuth2: Manager reuses valid token", async () => {
  // Create http-client.private.env.json with existing token
  const privateFile = join(testDir, "http-client.private.env.json");
  const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
  writeFileSync(
    privateFile,
    JSON.stringify(
      {
        default: {
          auth_data: {
            "test-auth-2": {
              access_token: "cached-token-456",
              token_type: "Bearer",
              expires_at: futureExpiry,
            },
          },
        },
      },
      null,
      2,
    ),
  );

  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "test-auth-2": {
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

  const manager = new OAuth2Manager("default", testDir);
  const token = await manager.getAccessToken("test-auth-2");
  // Should use cached token, not make a new request
  expect(token).toBe("cached-token-456");
});

test("OAuth2: Manager handles Password grant type", async () => {
  // Create a separate token server for password grant
  const passwordTokenServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/password-token" && req.method === "POST") {
        const body = await req.text();
        const params = new URLSearchParams(body);

        if (
          params.get("grant_type") === "password" &&
          params.get("username") === "testuser" &&
          params.get("password") === "testpass"
        ) {
          return Response.json({
            access_token: "password-token-789",
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  const passwordTokenUrl = `http://localhost:${passwordTokenServer.port}/password-token`;

  // Create http-client.env.json
  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "test-password-auth": {
                Type: "OAuth2",
                "Grant Type": "Password",
                "Token URL": passwordTokenUrl,
                "Client ID": "test-client-id",
                "Client Secret": "test-client-secret",
                Username: "testuser",
                Password: "testpass",
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

  const manager = new OAuth2Manager("default", testDir);
  const token = await manager.getAccessToken("test-password-auth");
  expect(token).toBe("password-token-789");

  passwordTokenServer.stop();
});

test("OAuth2: Manager throws error for unsupported grant type", async () => {
  const envFile = join(testDir, "http-client.env.json");
  writeFileSync(
    envFile,
    JSON.stringify(
      {
        default: {
          Security: {
            Auth: {
              "test-device-auth": {
                Type: "OAuth2",
                "Grant Type": "Device Authorization",
                "Token URL": tokenUrl,
                "Client ID": "test-client-id",
              },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  const manager = new OAuth2Manager("default", testDir);
  await expect(manager.getAccessToken("test-device-auth")).rejects.toThrow(
    "Device Authorization",
  );
});

test("OAuth2: PKCE generation works", async () => {
  const pkce = await generatePKCE();
  expect(pkce.verifier).toBeDefined();
  expect(pkce.challenge).toBeDefined();
  expect(pkce.method).toBe("S256");
  expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
  expect(pkce.challenge.length).toBeGreaterThan(0);
  expect(pkce.challenge).not.toBe(pkce.verifier); // Challenge should be hashed

  const pkcePlain = generatePKCEPlain();
  expect(pkcePlain.verifier).toBeDefined();
  expect(pkcePlain.challenge).toBeDefined();
  expect(pkcePlain.method).toBe("Plain");
  expect(pkcePlain.challenge).toBe(pkcePlain.verifier); // Plain should be same
});
