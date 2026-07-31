import { spawn } from "child_process";
import open from "open";
import {
  applyOAuth2CustomRequestParameters,
  pkceMethodQueryValue,
} from "./request-builders";
import type { OAuth2Config } from "./types";

/**
 * Generate PKCE code verifier and challenge.
 */
export async function generatePKCE(): Promise<{
  verifier: string;
  challenge: string;
  method: "S256";
}> {
  // Generate random 43-128 character string (per RFC 7636)
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const verifier = Buffer.from(randomBytes).toString("base64url").slice(0, 43);

  // Generate challenge using S256 (SHA256 hash)
  const cryptoModule = await import("crypto");
  const hash = cryptoModule.createHash("sha256");
  hash.update(verifier, "utf8");
  const challenge = hash.digest("base64url");

  return { verifier, challenge, method: "S256" };
}

/**
 * Generate PKCE with plain method (for testing or when S256 not supported).
 */
export function generatePKCEPlain(): {
  verifier: string;
  challenge: string;
  method: "Plain";
} {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const verifier = Buffer.from(randomBytes).toString("base64url").slice(0, 43);
  return { verifier, challenge: verifier, method: "Plain" };
}

/**
 * Open browser with the given URL.
 * Uses Browser CMD if provided, otherwise uses system default browser.
 * Never blocks the OAuth flow on the browser process (awaiting `open()` can hang
 * indefinitely on some Linux setups when the opener waits on the browser).
 */
export async function openBrowser(
  url: string,
  browserCmd?: string,
): Promise<void> {
  if (browserCmd) {
    // Custom browser command (e.g., "browser.js http://localhost:8080/callback")
    const [cmd, ...args] = browserCmd.split(" ");
    if (!cmd) return;
    const child = spawn(cmd, [...args, url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  void open(url, { wait: false }).catch((err: unknown) => {
    console.error("Failed to open browser for OAuth2:", err);
  });
}

/**
 * Check if redirect URL is localhost or 127.0.0.1.
 */
export function isLocalhostRedirect(redirectUrl: string): boolean {
  try {
    const url = new URL(redirectUrl);
    const hostname = url.hostname.toLowerCase();
    // Check for localhost, 127.0.0.1, and IPv6 localhost (::1)
    // Note: URL parsing normalizes [::1] to just "::1" in hostname
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * Parse redirect input (URL, query string, or raw code/token) into OAuth2 result.
 * Used for prompt continuation.
 */
export function parseRedirectInput(
  input: string,
  grantType: "Authorization Code" | "Implicit",
): {
  code?: string;
  access_token?: string;
  id_token?: string;
  error?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("No redirect URL or authorization code provided");
  }

  // Try to parse as full URL first
  let redirectUrlParsed: URL | null = null;
  try {
    redirectUrlParsed = new URL(trimmed);
  } catch {
    // Not a full URL - try to parse as partial URL or query string
    if (trimmed.includes("?")) {
      // Has query string - try to construct a URL
      const queryPart = trimmed.includes("http")
        ? trimmed
        : `http://localhost${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
      try {
        redirectUrlParsed = new URL(queryPart);
      } catch {
        // Still can't parse - might be just query string
        redirectUrlParsed = new URL(
          `http://localhost/?${trimmed.split("?")[1]}`,
        );
      }
    } else if (trimmed.includes("=")) {
      // Looks like query parameters without ? prefix
      redirectUrlParsed = new URL(`http://localhost/?${trimmed}`);
    } else {
      // Might be just the authorization code itself (no URL)
      // For Authorization Code grant, accept it directly
      if (grantType === "Authorization Code") {
        return { code: trimmed };
      }
      // For Implicit grant, might be just the access token
      // But we can't distinguish, so try to parse as URL with token param
      redirectUrlParsed = new URL(`http://localhost/?access_token=${trimmed}`);
    }
  }

  // Extract parameters from URL
  const code = redirectUrlParsed?.searchParams.get("code");
  const access_token = redirectUrlParsed?.searchParams.get("access_token");
  const id_token = redirectUrlParsed?.searchParams.get("id_token");
  const error = redirectUrlParsed?.searchParams.get("error");

  if (error) {
    return { error };
  }

  if (grantType === "Authorization Code") {
    if (code) {
      return { code };
    }
    // Providers (e.g. Microsoft Entra) may issue codes containing '='. When URL
    // parsing did not yield ?code=, treat the whole pasted value as the code.
    return { code: trimmed };
  } else {
    // Implicit grant
    if (!access_token) {
      throw new Error("No access token found in redirect URL");
    }
    return { access_token, id_token: id_token ?? undefined };
  }
}

/**
 * Start a local HTTP server to intercept OAuth2 redirect.
 * Returns the server and a promise that resolves with the authorization code/token.
 * Only use this when redirect URL is localhost/127.0.0.1 or Browser CMD is specified.
 */
export function startRedirectServer(redirectUrl: string): {
  server: { stop: () => void; port: number };
  promise: Promise<{
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  }>;
} {
  const url = new URL(redirectUrl);
  // Use port 0 to let the OS assign an available port if no port specified
  // If port is specified but conflicts, we'll let Bun handle the error
  const requestedPort = url.port ? parseInt(url.port, 10) : 0;
  const path = url.pathname || "/";

  let resolvePromise: (value: {
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  }) => void;
  const promise = new Promise<{
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  }>((resolve) => {
    resolvePromise = resolve;
  });

  const server = Bun.serve({
    port: requestedPort,
    async fetch(req) {
      const requestUrl = new URL(req.url);
      if (requestUrl.pathname === path) {
        // Extract parameters from query string
        const code = requestUrl.searchParams.get("code");
        const access_token = requestUrl.searchParams.get("access_token");
        const id_token = requestUrl.searchParams.get("id_token");
        const error = requestUrl.searchParams.get("error");

        // Resolve promise with the result
        resolvePromise({
          code: code ?? undefined,
          access_token: access_token ?? undefined,
          id_token: id_token ?? undefined,
          error: error ?? undefined,
        });

        // Return a simple HTML response
        return new Response(
          `
          <html>
            <body>
              <h1>Authorization successful!</h1>
              <p>You can close this window.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
          `,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  const actualPort = server.port ?? requestedPort ?? 0;
  return {
    server: {
      stop: () => server.stop(),
      port: actualPort,
    },
    promise,
  };
}

/**
 * Build authorization URL for Authorization Code or Implicit grant.
 */
export function buildAuthorizationUrl(
  config: OAuth2Config,
  redirectUrl: string,
  pkce?: { verifier: string; challenge: string; method: "S256" | "Plain" },
): string {
  const authUrl = new URL(config["Auth URL"]!);

  // Required parameters
  authUrl.searchParams.set("client_id", config["Client ID"]);
  authUrl.searchParams.set("redirect_uri", redirectUrl);

  // Response type
  if (config["Grant Type"] === "Authorization Code") {
    authUrl.searchParams.set(
      "response_type",
      config["Response Type"] ?? "code",
    );
  } else if (config["Grant Type"] === "Implicit") {
    authUrl.searchParams.set(
      "response_type",
      config["Response Type"] ?? "token",
    );
  }

  // Scope
  if (config.Scope) {
    authUrl.searchParams.set("scope", config.Scope);
  }

  // PKCE
  if (pkce) {
    authUrl.searchParams.set("code_challenge", pkce.challenge);
    authUrl.searchParams.set(
      "code_challenge_method",
      pkceMethodQueryValue(pkce.method),
    );
  }

  const authParams: Record<string, string> = {};
  applyOAuth2CustomRequestParameters(config, "In Auth Request", authParams);
  for (const [key, value] of Object.entries(authParams)) {
    authUrl.searchParams.set(key, value);
  }

  return authUrl.toString();
}
