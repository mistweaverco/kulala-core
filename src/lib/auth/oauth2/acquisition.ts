import got from "got";
import type { OAuth2Config, OAuth2TokenData } from "./types";
import {
  buildAuthorizationUrl,
  generatePKCE,
  generatePKCEPlain,
  isLocalhostRedirect,
  openBrowser,
  startRedirectServer,
} from "./browser-flow";
import {
  createOAuth2AuthorizationCodePrompt,
  createOAuth2ImplicitPrompt,
} from "./prompt-helper";
import { OAuth2PromptError } from "./prompt-error";
import type { KulalaPromptResponse } from "../../runner/types";

/**
 * Acquire OAuth2 access token using Client Credentials grant.
 */
export async function acquireClientCredentialsToken(
  config: OAuth2Config,
): Promise<OAuth2TokenData> {
  if (config["Grant Type"] !== "Client Credentials") {
    throw new Error(
      `Invalid grant type for Client Credentials: ${config["Grant Type"]}`,
    );
  }

  if (!config["Token URL"]) {
    throw new Error("Token URL is required for Client Credentials grant");
  }

  if (!config["Client ID"]) {
    throw new Error("Client ID is required");
  }

  const clientCredentialsLocation = config["Client Credentials"] ?? "basic";
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(config["Custom Headers"] ?? {}),
  };

  const bodyParams: Record<string, string> = {
    grant_type: "client_credentials",
    ...(config.Scope ? { scope: config.Scope } : {}),
  };

  // Add custom request parameters that should be used "In Token Request" or "Everywhere"
  if (config["Custom Request Parameters"]) {
    for (const [key, value] of Object.entries(
      config["Custom Request Parameters"],
    )) {
      if (typeof value === "string") {
        bodyParams[key] = value;
      } else if (Array.isArray(value)) {
        bodyParams[key] = value.join(" ");
      } else if (typeof value === "object" && value !== null) {
        const param = value as { Value: string | string[]; Use: string };
        if (param.Use === "In Token Request" || param.Use === "Everywhere") {
          if (typeof param.Value === "string") {
            bodyParams[key] = param.Value;
          } else if (Array.isArray(param.Value)) {
            bodyParams[key] = param.Value.join(" ");
          }
        }
      }
    }
  }

  // Handle client credentials location
  if (clientCredentialsLocation === "basic") {
    // Basic auth header
    const credentials = `${config["Client ID"]}:${config["Client Secret"] ?? ""}`;
    const encoded = Buffer.from(credentials, "utf8").toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else if (clientCredentialsLocation === "in body") {
    // Client credentials in body
    bodyParams.client_id = config["Client ID"];
    if (config["Client Secret"]) {
      bodyParams.client_secret = config["Client Secret"];
    }
  } else if (clientCredentialsLocation === "jwt") {
    // JWT assertion (requires Assertion or JWT config)
    if (config.Assertion) {
      bodyParams.client_assertion = config.Assertion;
      bodyParams.client_assertion_type =
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    } else if (config.JWT) {
      // Generate JWT token
      const jwt = await generateJWT(config.JWT, config["Client Secret"] ?? "");
      bodyParams.client_assertion = jwt;
      bodyParams.client_assertion_type =
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
    } else {
      throw new Error(
        "JWT client credentials requires Assertion or JWT config",
      );
    }
  }
  // "none" means no client credentials

  const formBody = new URLSearchParams(bodyParams).toString();

  const response = await got.post(config["Token URL"], {
    headers,
    body: formBody,
    retry: { limit: 0 },
  });

  const tokenData = JSON.parse(response.body) as OAuth2TokenData;

  // Calculate expires_at if expires_in is provided
  if (tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  } else if (!tokenData.expires_in && !tokenData.expires_at) {
    // Default to 10 seconds if not provided
    tokenData.expires_at =
      Math.floor(Date.now() / 1000) + (config["Expires In"] ?? 10);
  }

  return tokenData;
}

/**
 * Generate JWT token for OAuth2 client credentials.
 */
async function generateJWT(
  jwtConfig: NonNullable<OAuth2Config["JWT"]>,
  secret: string,
): Promise<string> {
  const header = jwtConfig.Header;
  const payload = { ...jwtConfig.Payload };

  // Set iat and exp if not provided
  const now = Math.floor(Date.now() / 1000);
  if (!payload.iat) {
    payload.iat = now;
  }
  if (!payload.exp) {
    payload.exp = (payload.iat as number) + 50; // Default 50 seconds
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Sign with HS256 or RS256
  if (header.alg === "HS256") {
    const crypto = await import("crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(unsignedToken);
    const signature = hmac.digest("base64url");
    return `${unsignedToken}.${signature}`;
  } else if (header.alg === "RS256") {
    // RS256 requires private key - would need to load from config
    // For now, throw error - this requires additional implementation
    throw new Error(
      "RS256 JWT signing not yet implemented (requires private key)",
    );
  } else {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }
}

/**
 * Check if token is expired or will expire soon (within 60 seconds).
 */
export function isTokenExpired(tokenData: OAuth2TokenData): boolean {
  if (!tokenData.expires_at) return false;
  const now = Math.floor(Date.now() / 1000);
  return tokenData.expires_at <= now + 60; // 60 second buffer
}

/**
 * Exchange authorization code for access token.
 * This is the second step of the Authorization Code flow.
 */
export async function exchangeAuthorizationCode(
  config: OAuth2Config,
  code: string,
  pkce?: { verifier: string; challenge: string; method: "S256" | "Plain" },
): Promise<OAuth2TokenData> {
  if (!config["Token URL"]) {
    throw new Error("Token URL is required for Authorization Code grant");
  }

  const redirectUrl = config["Redirect URL"]!;

  // Exchange code for token
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(config["Custom Headers"] ?? {}),
  };

  const bodyParams: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUrl,
    client_id: config["Client ID"],
    ...(pkce ? { code_verifier: pkce.verifier } : {}),
  };

  // Add client secret if provided
  if (config["Client Secret"]) {
    const clientCredentialsLocation = config["Client Credentials"] ?? "basic";
    if (clientCredentialsLocation === "basic") {
      const credentials = `${config["Client ID"]}:${config["Client Secret"]}`;
      const encoded = Buffer.from(credentials, "utf8").toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    } else if (clientCredentialsLocation === "in body") {
      bodyParams.client_secret = config["Client Secret"];
    }
  }

  // Add custom request parameters for token request
  if (config["Custom Request Parameters"]) {
    for (const [key, value] of Object.entries(
      config["Custom Request Parameters"],
    )) {
      let shouldInclude = false;
      let paramValue: string | string[] | undefined;

      if (typeof value === "string") {
        shouldInclude = true;
        paramValue = value;
      } else if (Array.isArray(value)) {
        shouldInclude = true;
        paramValue = value;
      } else if (typeof value === "object" && value !== null) {
        const param = value as { Value: string | string[]; Use: string };
        shouldInclude =
          param.Use === "In Token Request" || param.Use === "Everywhere";
        paramValue = param.Value;
      }

      if (shouldInclude && paramValue !== undefined) {
        if (typeof paramValue === "string") {
          bodyParams[key] = paramValue;
        } else if (Array.isArray(paramValue)) {
          bodyParams[key] = paramValue.join(" ");
        }
      }
    }
  }

  const formBody = new URLSearchParams(bodyParams).toString();

  const response = await got.post(config["Token URL"], {
    headers,
    body: formBody,
    retry: { limit: 0 },
  });

  const tokenData = JSON.parse(response.body) as OAuth2TokenData;

  // Calculate expires_at if expires_in is provided
  if (tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  } else if (!tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at =
      Math.floor(Date.now() / 1000) + (config["Expires In"] ?? 10);
  }

  return tokenData;
}

/**
 * Acquire OAuth2 access token using Authorization Code grant.
 */
export async function acquireAuthorizationCodeToken(
  config: OAuth2Config,
  authId: string,
  env: string,
  startDir: string,
  code?: string,
  pkce?: { verifier: string; challenge: string; method: "S256" | "Plain" },
): Promise<OAuth2TokenData> {
  if (config["Grant Type"] !== "Authorization Code") {
    throw new Error(
      `Invalid grant type for Authorization Code: ${config["Grant Type"]}`,
    );
  }

  if (!config["Auth URL"]) {
    throw new Error("Auth URL is required for Authorization Code grant");
  }

  if (!config["Token URL"]) {
    throw new Error("Token URL is required for Authorization Code grant");
  }

  if (!config["Redirect URL"]) {
    throw new Error("Redirect URL is required for Authorization Code grant");
  }

  // Generate PKCE if enabled (use provided pkce parameter if available, otherwise generate)
  let pkceValue:
    | { verifier: string; challenge: string; method: "S256" | "Plain" }
    | undefined = pkce;
  if (!pkceValue && config.PKCE) {
    if (typeof config.PKCE === "boolean" && config.PKCE) {
      // Default PKCE with S256
      pkceValue = await generatePKCE();
    } else if (typeof config.PKCE === "object") {
      if (config.PKCE["Code Verifier"]) {
        // Use provided verifier
        const verifier = config.PKCE["Code Verifier"];
        const method = config.PKCE["Code Challenge Method"] ?? "S256";
        if (method === "Plain") {
          pkceValue = { verifier, challenge: verifier, method: "Plain" };
        } else {
          // S256: hash the verifier
          const cryptoModule = await import("crypto");
          const hash = cryptoModule.createHash("sha256");
          hash.update(verifier, "utf8");
          const challenge = hash.digest("base64url");
          pkceValue = { verifier, challenge, method: "S256" };
        }
      } else {
        // Generate new PKCE
        const method = config.PKCE["Code Challenge Method"] ?? "S256";
        pkceValue =
          method === "Plain" ? generatePKCEPlain() : await generatePKCE();
      }
    }
  }

  // Build authorization URL
  const redirectUrl = config["Redirect URL"];
  const authUrl = buildAuthorizationUrl(config, redirectUrl, pkceValue);

  // Check if we should use local server or prompt system
  const useLocalServer =
    isLocalhostRedirect(redirectUrl) || !!config["Browser CMD"];

  let result: {
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  let server: { stop: () => void; port: number } | undefined;

  if (useLocalServer) {
    // Start redirect server for localhost redirects or when Browser CMD is specified
    const serverResult = startRedirectServer(redirectUrl);
    server = serverResult.server;

    try {
      // Open browser (no-op in test environment)
      if (process.env.NODE_ENV !== "test") {
        await openBrowser(authUrl, config["Browser CMD"]);
      }

      // Wait for redirect (with timeout)
      const timeout = new Promise<never>(
        (_, reject) =>
          setTimeout(() => reject(new Error("Authorization timeout")), 300000), // 5 minutes
      );
      result = await Promise.race([serverResult.promise, timeout]);
    } finally {
      server.stop();
    }
  } else {
    // Use prompt system for non-localhost redirects
    const promptId = await createOAuth2AuthorizationCodePrompt(
      config,
      authId,
      env,
      startDir,
      pkceValue,
    );
    const promptResponse: KulalaPromptResponse = {
      success: false,
      prompt: true,
      promptId,
      promptType: "oauth2_authorization_code",
      message: `Please complete the authorization in your browser.\nAfter authorization, you will be redirected to: ${redirectUrl}\nPlease copy the full redirect URL or authorization code and use it to continue the request.`,
      inputs: [
        {
          id: "redirect_url",
          label: "Redirect URL or Authorization Code",
          type: "url",
          required: true,
        },
      ],
    };
    throw new OAuth2PromptError(promptResponse);
  }

  if (result.error) {
    throw new Error(`OAuth2 authorization error: ${result.error}`);
  }

  // If code is provided (from continuation), skip authorization and go straight to exchange
  if (code) {
    return await exchangeAuthorizationCode(config, code, pkceValue);
  }

  if (!result.code) {
    throw new Error("No authorization code received");
  }

  // Exchange code for token
  return await exchangeAuthorizationCode(config, result.code, pkceValue);
}

/**
 * Acquire OAuth2 access token using Implicit grant (browser-based).
 */
export async function acquireImplicitToken(
  config: OAuth2Config,
  authId: string,
  env: string,
  startDir: string,
): Promise<OAuth2TokenData> {
  if (config["Grant Type"] !== "Implicit") {
    throw new Error(`Invalid grant type for Implicit: ${config["Grant Type"]}`);
  }

  if (!config["Auth URL"]) {
    throw new Error("Auth URL is required for Implicit grant");
  }

  if (!config["Redirect URL"]) {
    throw new Error("Redirect URL is required for Implicit grant");
  }

  // Build authorization URL
  const redirectUrl = config["Redirect URL"];
  const authUrl = buildAuthorizationUrl(config, redirectUrl);

  // Check if we should use local server or prompt system
  const useLocalServer =
    isLocalhostRedirect(redirectUrl) || !!config["Browser CMD"];

  let result: {
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  };
  let server: { stop: () => void; port: number } | undefined;

  if (useLocalServer) {
    // Start redirect server for localhost redirects or when Browser CMD is specified
    const serverResult = startRedirectServer(redirectUrl);
    server = serverResult.server;

    try {
      // Open browser (no-op in test environment)
      if (process.env.NODE_ENV !== "test") {
        await openBrowser(authUrl, config["Browser CMD"]);
      }

      // Wait for redirect (with timeout)
      const timeout = new Promise<never>(
        (_, reject) =>
          setTimeout(() => reject(new Error("Authorization timeout")), 300000), // 5 minutes
      );
      result = await Promise.race([serverResult.promise, timeout]);
    } finally {
      server.stop();
    }
  } else {
    // Use prompt system for non-localhost redirects
    const promptId = await createOAuth2ImplicitPrompt(
      config,
      authId,
      env,
      startDir,
    );
    const promptResponse: KulalaPromptResponse = {
      success: false,
      prompt: true,
      promptId,
      promptType: "oauth2_implicit_token",
      message: `Please complete the authorization in your browser.\nAfter authorization, you will be redirected to: ${redirectUrl}\nPlease copy the full redirect URL or access token and use it to continue the request.`,
      inputs: [
        {
          id: "redirect_url",
          label: "Redirect URL or Access Token",
          type: "url",
          required: true,
        },
      ],
    };
    throw new OAuth2PromptError(promptResponse);
  }

  if (result.error) {
    throw new Error(`OAuth2 authorization error: ${result.error}`);
  }

  if (!result.access_token) {
    throw new Error("No access token received");
  }

  // Implicit grant returns token directly in redirect
  const tokenData: OAuth2TokenData = {
    access_token: result.access_token,
    token_type: "Bearer",
    id_token: result.id_token,
  };

  // Calculate expires_at (Implicit grants typically don't provide expires_in)
  tokenData.expires_at =
    Math.floor(Date.now() / 1000) + (config["Expires In"] ?? 3600);

  return tokenData;
}

/**
 * Acquire OAuth2 access token using Password grant.
 */
export async function acquirePasswordToken(
  config: OAuth2Config,
): Promise<OAuth2TokenData> {
  if (config["Grant Type"] !== "Password") {
    throw new Error(`Invalid grant type for Password: ${config["Grant Type"]}`);
  }

  if (!config["Token URL"]) {
    throw new Error("Token URL is required for Password grant");
  }

  if (!config.Username || !config.Password) {
    throw new Error("Username and Password are required for Password grant");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(config["Custom Headers"] ?? {}),
  };

  const bodyParams: Record<string, string> = {
    grant_type: "password",
    username: config.Username,
    password: config.Password,
    ...(config["Client ID"] ? { client_id: config["Client ID"] } : {}),
    ...(config.Scope ? { scope: config.Scope } : {}),
  };

  // Add client secret if provided
  if (config["Client Secret"]) {
    const clientCredentialsLocation = config["Client Credentials"] ?? "basic";
    if (clientCredentialsLocation === "basic") {
      const credentials = `${config["Client ID"]}:${config["Client Secret"]}`;
      const encoded = Buffer.from(credentials, "utf8").toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    } else if (clientCredentialsLocation === "in body") {
      bodyParams.client_secret = config["Client Secret"];
    }
  }

  // Add custom request parameters
  if (config["Custom Request Parameters"]) {
    for (const [key, value] of Object.entries(
      config["Custom Request Parameters"],
    )) {
      let shouldInclude = false;
      let paramValue: string | string[] | undefined;

      if (typeof value === "string") {
        shouldInclude = true;
        paramValue = value;
      } else if (Array.isArray(value)) {
        shouldInclude = true;
        paramValue = value;
      } else if (typeof value === "object" && value !== null) {
        const param = value as { Value: string | string[]; Use: string };
        shouldInclude =
          param.Use === "In Token Request" || param.Use === "Everywhere";
        paramValue = param.Value;
      }

      if (shouldInclude && paramValue !== undefined) {
        if (typeof paramValue === "string") {
          bodyParams[key] = paramValue;
        } else if (Array.isArray(paramValue)) {
          bodyParams[key] = paramValue.join(" ");
        }
      }
    }
  }

  const formBody = new URLSearchParams(bodyParams).toString();

  const response = await got.post(config["Token URL"], {
    headers,
    body: formBody,
    retry: { limit: 0 },
  });

  const tokenData = JSON.parse(response.body) as OAuth2TokenData;

  // Calculate expires_at if expires_in is provided
  if (tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  } else if (!tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at =
      Math.floor(Date.now() / 1000) + (config["Expires In"] ?? 10);
  }

  return tokenData;
}

/**
 * Refresh OAuth2 access token using refresh_token.
 */
export async function refreshOAuth2Token(
  config: OAuth2Config,
  refreshToken: string,
): Promise<OAuth2TokenData> {
  if (!config["Token URL"]) {
    throw new Error("Token URL is required for token refresh");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(config["Custom Headers"] ?? {}),
  };

  const bodyParams: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(config["Client ID"] ? { client_id: config["Client ID"] } : {}),
    ...(config["Client Secret"]
      ? { client_secret: config["Client Secret"] }
      : {}),
  };

  const formBody = new URLSearchParams(bodyParams).toString();

  const response = await got.post(config["Token URL"], {
    headers,
    body: formBody,
    retry: { limit: 0 },
  });

  const tokenData = JSON.parse(response.body) as OAuth2TokenData;

  // Calculate expires_at if expires_in is provided
  if (tokenData.expires_in && !tokenData.expires_at) {
    tokenData.expires_at = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  }

  return tokenData;
}
