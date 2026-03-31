import type { OAuth2Config } from "./types";
import { createPrompt, type PromptContext } from "../../persistence";
import { buildAuthorizationUrl, openBrowser } from "./browser-flow";

/**
 * Create a prompt for OAuth2 authorization code flow.
 * Returns the prompt ID and opens the browser.
 */
export async function createOAuth2AuthorizationCodePrompt(
  config: OAuth2Config,
  authId: string,
  env: string,
  startDir: string,
  pkce?: { verifier: string; challenge: string; method: "S256" | "Plain" },
): Promise<string> {
  const redirectUrl = config["Redirect URL"]!;
  const authUrl = buildAuthorizationUrl(config, redirectUrl, pkce);

  const context: PromptContext = {
    promptType: "oauth2_authorization_code",
    config,
    authId,
    env,
    startDir,
    redirectUrl,
    pkce,
    authUrl,
  };

  const promptId = createPrompt("oauth2_authorization_code", context, 300); // 5 minutes expiry

  // Open browser (no-op in test environment)
  if (process.env.NODE_ENV !== "test") {
    await openBrowser(authUrl, config["Browser CMD"]);
  }

  return promptId;
}

/**
 * Create a prompt for OAuth2 implicit flow.
 * Returns the prompt ID and opens the browser.
 */
export async function createOAuth2ImplicitPrompt(
  config: OAuth2Config,
  authId: string,
  env: string,
  startDir: string,
): Promise<string> {
  const redirectUrl = config["Redirect URL"]!;
  const authUrl = buildAuthorizationUrl(config, redirectUrl);

  const context: PromptContext = {
    promptType: "oauth2_implicit_token",
    config,
    authId,
    env,
    startDir,
    redirectUrl,
    authUrl,
  };

  const promptId = createPrompt("oauth2_implicit_token", context, 300); // 5 minutes expiry

  // Open browser (no-op in test environment)
  if (process.env.NODE_ENV !== "test") {
    await openBrowser(authUrl, config["Browser CMD"]);
  }

  return promptId;
}
