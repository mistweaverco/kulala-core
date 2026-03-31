import { expect, test, beforeAll, afterAll } from "bun:test";
import { unlinkSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import {
  acquireAuthorizationCodeToken,
  acquireImplicitToken,
  acquirePasswordToken,
} from "./acquisition";
import {
  buildAuthorizationUrl,
  generatePKCE,
  generatePKCEPlain,
  isLocalhostRedirect,
  startRedirectServer,
} from "./browser-flow";
import type { OAuth2Config } from "./types";
import { setDbForTesting, getDbInMemory, closeDb } from "../../persistence";

let testDir: string;
let authServer: ReturnType<typeof Bun.serve>;
let tokenServer: ReturnType<typeof Bun.serve>;
let authUrl: string;
let tokenUrl: string;
let redirectUrl: string;

beforeAll(() => {
  // Set test environment to prevent browser opening
  process.env.NODE_ENV = "test";

  testDir = join(process.cwd(), ".test-oauth2-browser");
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }

  // Set up in-memory database for tests
  const db = getDbInMemory();
  setDbForTesting(db);

  // Start mock authorization server (simulates OAuth provider)
  authServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/authorize" && req.method === "GET") {
        // Simulate authorization - redirect back with code
        const redirectUri = url.searchParams.get("redirect_uri");
        const state = url.searchParams.get("state");
        const code = "test-auth-code-123";

        if (redirectUri) {
          const redirect = new URL(redirectUri);
          redirect.searchParams.set("code", code);
          if (state) redirect.searchParams.set("state", state);
          return Response.redirect(redirect.toString(), 302);
        }
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  // Start mock token server
  tokenServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/token" && req.method === "POST") {
        const body = await req.text();
        const params = new URLSearchParams(body);

        const grantType = params.get("grant_type");

        if (grantType === "authorization_code") {
          const code = params.get("code");

          if (code === "test-auth-code-123") {
            return Response.json({
              access_token: "test-access-token-from-code",
              token_type: "Bearer",
              expires_in: 3600,
              refresh_token: "test-refresh-token",
            });
          }
        } else if (grantType === "password") {
          const username = params.get("username");
          const password = params.get("password");

          if (username === "testuser" && password === "testpass") {
            return Response.json({
              access_token: "test-access-token-from-password",
              token_type: "Bearer",
              expires_in: 3600,
            });
          }
        }

        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  if (authServer.port === undefined || tokenServer.port === undefined) {
    throw new Error("Test servers did not expose listening ports");
  }
  authUrl = `http://localhost:${authServer.port}/authorize`;
  tokenUrl = `http://localhost:${tokenServer.port}/token`;
  redirectUrl = "http://localhost:8080/callback";
});

afterAll(() => {
  authServer.stop();
  tokenServer.stop();
  closeDb();
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

test("OAuth2: buildAuthorizationUrl creates correct URL", () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Authorization Code",
    "Auth URL": authUrl,
    "Token URL": tokenUrl,
    "Redirect URL": redirectUrl,
    "Client ID": "test-client-id",
    Scope: "read write",
  };

  const url = buildAuthorizationUrl(config, redirectUrl);
  const parsed = new URL(url);

  expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
  expect(parsed.searchParams.get("redirect_uri")).toBe(redirectUrl);
  expect(parsed.searchParams.get("response_type")).toBe("code");
  expect(parsed.searchParams.get("scope")).toBe("read write");
});

test("OAuth2: buildAuthorizationUrl includes PKCE", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Authorization Code",
    "Auth URL": authUrl,
    "Token URL": tokenUrl,
    "Redirect URL": redirectUrl,
    "Client ID": "test-client-id",
  };

  const pkce = await generatePKCE();
  const url = buildAuthorizationUrl(config, redirectUrl, pkce);
  const parsed = new URL(url);

  expect(parsed.searchParams.get("code_challenge")).toBe(pkce.challenge);
  expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
});

test("OAuth2: startRedirectServer intercepts redirect", async () => {
  // Use port 0 to get a random available port
  const { server, promise } = startRedirectServer(
    "http://localhost:0/callback",
  );

  // Simulate redirect
  setTimeout(async () => {
    await fetch(`http://localhost:${server.port}/callback?code=test-code-456`);
  }, 100);

  const result = await promise;
  expect(result.code).toBe("test-code-456");

  server.stop();
});

test("OAuth2: Authorization Code grant validates required fields", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Authorization Code",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
  };

  await expect(
    acquireAuthorizationCodeToken(
      {
        ...config,
        "Auth URL": undefined,
      } as OAuth2Config,
      "test-auth",
      "default",
      testDir,
    ),
  ).rejects.toThrow("Auth URL is required");

  await expect(
    acquireAuthorizationCodeToken(
      {
        ...config,
        "Auth URL": authUrl,
        "Redirect URL": undefined,
      } as OAuth2Config,
      "test-auth",
      "default",
      testDir,
    ),
  ).rejects.toThrow("Redirect URL is required");
});

test("OAuth2: Password grant acquires token", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Password",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
    "Client Secret": "test-client-secret",
    Username: "testuser",
    Password: "testpass",
    "Client Credentials": "basic",
  };

  const tokenData = await acquirePasswordToken(config);
  expect(tokenData.access_token).toBe("test-access-token-from-password");
  expect(tokenData.token_type).toBe("Bearer");
  expect(tokenData.expires_in).toBe(3600);
});

test("OAuth2: Password grant validates required fields", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Password",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
  };

  await expect(
    acquirePasswordToken({
      ...config,
      Username: undefined,
    } as OAuth2Config),
  ).rejects.toThrow("Username and Password are required");

  await expect(
    acquirePasswordToken({
      ...config,
      Password: undefined,
    } as OAuth2Config),
  ).rejects.toThrow("Username and Password are required");
});

test("OAuth2: Implicit grant validates required fields", async () => {
  const config: OAuth2Config = {
    Type: "OAuth2",
    "Grant Type": "Implicit",
    "Token URL": tokenUrl,
    "Client ID": "test-client-id",
  };

  await expect(
    acquireImplicitToken(
      {
        ...config,
        "Auth URL": undefined,
      } as OAuth2Config,
      "test-auth",
      "default",
      testDir,
    ),
  ).rejects.toThrow("Auth URL is required");

  await expect(
    acquireImplicitToken(
      {
        ...config,
        "Auth URL": authUrl,
        "Redirect URL": undefined,
      } as OAuth2Config,
      "test-auth",
      "default",
      testDir,
    ),
  ).rejects.toThrow("Redirect URL is required");
});

test("OAuth2: PKCE generation", async () => {
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

test("OAuth2: isLocalhostRedirect detects localhost URLs", () => {
  expect(isLocalhostRedirect("http://localhost:8080/callback")).toBe(true);
  expect(isLocalhostRedirect("http://127.0.0.1:8080/callback")).toBe(true);
  expect(isLocalhostRedirect("http://localhost/callback")).toBe(true);
  expect(isLocalhostRedirect("http://127.0.0.1/callback")).toBe(true);
  expect(isLocalhostRedirect("https://localhost:8443/callback")).toBe(true);
  // IPv6 localhost - URL parser normalizes [::1] to ::1
  expect(isLocalhostRedirect("http://[::1]:8080/callback")).toBe(true);

  expect(isLocalhostRedirect("http://example.com:8080/callback")).toBe(false);
  expect(isLocalhostRedirect("https://api.example.com/callback")).toBe(false);
  expect(isLocalhostRedirect("http://192.168.1.1:8080/callback")).toBe(false);
});
