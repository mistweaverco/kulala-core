import type { OAuth2Config, OAuth2TokenData } from "./types";
import { getPrompt, deletePrompt } from "../../persistence";
import { exchangeAuthorizationCode } from "./acquisition";
import { parseRedirectInput } from "./browser-flow";
import { saveOAuth2AuthData } from "./config";

/**
 * Continue OAuth2 flow from a prompt.
 * This function loads the prompt context, processes the user input, and completes the token acquisition.
 */
export async function continueOAuth2Flow(
  promptId: string,
  inputs: Array<{ id: string; value: string }>,
): Promise<OAuth2TokenData> {
  const prompt = getPrompt(promptId);
  if (!prompt) {
    throw new Error(`Prompt not found or expired: ${promptId}`);
  }

  if (
    prompt.promptType !== "oauth2_authorization_code" &&
    prompt.promptType !== "oauth2_implicit_token"
  ) {
    throw new Error(
      `Invalid prompt type for OAuth2 continuation: ${prompt.promptType}`,
    );
  }

  const context = prompt.context;
  const config = context.config as OAuth2Config;
  const authId = context.authId as string;
  const env = context.env as string;
  const startDir = context.startDir as string;
  const grantType = config["Grant Type"];

  // Convert array of inputs to a map for easier lookup
  const inputsMap = new Map(inputs.map((input) => [input.id, input.value]));

  // Get the user input (redirect URL or code)
  const redirectInput =
    inputsMap.get("redirect_url") ||
    inputsMap.get("code") ||
    inputsMap.get("access_token");
  if (!redirectInput) {
    throw new Error(
      "Missing required input: redirect_url, code, or access_token",
    );
  }

  // Parse the input to extract code/token
  let result: {
    code?: string;
    access_token?: string;
    id_token?: string;
    error?: string;
  };

  if (grantType === "Authorization Code") {
    result = parseRedirectInput(redirectInput, "Authorization Code");
  } else if (grantType === "Implicit") {
    result = parseRedirectInput(redirectInput, "Implicit");
  } else {
    throw new Error(`Invalid grant type for continuation: ${grantType}`);
  }

  if (result.error) {
    deletePrompt(promptId);
    throw new Error(`OAuth2 authorization error: ${result.error}`);
  }

  // Delete the prompt since we're using it
  deletePrompt(promptId);

  // Continue with token exchange
  if (grantType === "Authorization Code") {
    if (!result.code) {
      throw new Error("No authorization code received");
    }

    // Exchange the code for a token
    const pkce = context.pkce as
      | { verifier: string; challenge: string; method: "S256" | "Plain" }
      | undefined;
    const tokenData = await exchangeAuthorizationCode(
      config,
      result.code,
      pkce,
    );
    // Save the token
    saveOAuth2AuthData(env, startDir, authId, tokenData);
    return tokenData;
  } else {
    // Implicit grant - token is already in the redirect
    if (!result.access_token) {
      throw new Error("No access token received");
    }

    // For Implicit grant, we already have the token
    const tokenData: OAuth2TokenData = {
      access_token: result.access_token,
      token_type: "Bearer",
      id_token: result.id_token,
    };

    // Calculate expires_at
    tokenData.expires_at =
      Math.floor(Date.now() / 1000) + (config["Expires In"] ?? 3600);

    // Save the token
    saveOAuth2AuthData(env, startDir, authId, tokenData);
    return tokenData;
  }
}
