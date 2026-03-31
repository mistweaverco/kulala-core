import {
  loadOAuth2Configs,
  loadOAuth2AuthData,
  saveOAuth2AuthData,
} from "./config";
import {
  acquireAuthorizationCodeToken,
  acquireClientCredentialsToken,
  acquireImplicitToken,
  acquirePasswordToken,
  isTokenExpired,
  refreshOAuth2Token,
} from "./acquisition";
import type { OAuth2Config, OAuth2TokenData } from "./types";
import { OAuth2PromptError } from "./prompt-error";

/**
 * OAuth2 token manager. Handles token acquisition, refresh, and storage.
 */
export class OAuth2Manager {
  private configs: Map<string, OAuth2Config> = new Map();
  private tokens: Map<string, OAuth2TokenData> = new Map();
  private env: string;
  private startDir: string;

  constructor(env: string, startDir: string) {
    this.env = env;
    this.startDir = startDir;
    this.loadConfigs();
    this.loadTokens();
  }

  private loadConfigs(): void {
    this.configs = loadOAuth2Configs(this.env, this.startDir);
  }

  private loadTokens(): void {
    this.tokens = loadOAuth2AuthData(this.env, this.startDir);
  }

  /**
   * Get access token for auth-id. Acquires or refreshes token if needed.
   */
  async getAccessToken(authId: string): Promise<string | undefined> {
    const config = this.configs.get(authId);
    if (!config) {
      return undefined;
    }

    let tokenData = this.tokens.get(authId);

    // Check if token needs refresh
    if (tokenData && tokenData.refresh_token && isTokenExpired(tokenData)) {
      try {
        tokenData = await refreshOAuth2Token(config, tokenData.refresh_token);
        this.tokens.set(authId, tokenData);
        saveOAuth2AuthData(this.env, this.startDir, authId, tokenData);
      } catch {
        // Refresh failed, try acquiring new token
        tokenData = undefined;
      }
    }

    // Check if token is expired or missing
    if (!tokenData || isTokenExpired(tokenData)) {
      try {
        // Acquire new token based on grant type
        switch (config["Grant Type"]) {
          case "Client Credentials":
            tokenData = await acquireClientCredentialsToken(config);
            break;
          case "Authorization Code":
            tokenData = await acquireAuthorizationCodeToken(
              config,
              authId,
              this.env,
              this.startDir,
            );
            break;
          case "Implicit":
            tokenData = await acquireImplicitToken(
              config,
              authId,
              this.env,
              this.startDir,
            );
            break;
          case "Password":
            tokenData = await acquirePasswordToken(config);
            break;
          case "Device Authorization":
            throw new Error(
              'Grant type "Device Authorization" not yet implemented',
            );
          default:
            throw new Error(`Unsupported grant type: ${config["Grant Type"]}`);
        }
        this.tokens.set(authId, tokenData);
        saveOAuth2AuthData(this.env, this.startDir, authId, tokenData);
      } catch (error) {
        // Re-throw OAuth2PromptError so it can be handled upstream
        if (error instanceof OAuth2PromptError) {
          throw error;
        }
        throw error;
      }
    }

    return tokenData.access_token;
  }

  /**
   * Get ID token for auth-id.
   */
  async getIdToken(authId: string): Promise<string | undefined> {
    const config = this.configs.get(authId);
    if (!config) {
      return undefined;
    }

    let tokenData = this.tokens.get(authId);

    // Ensure we have a valid token
    if (!tokenData || isTokenExpired(tokenData)) {
      await this.getAccessToken(authId);
      tokenData = this.tokens.get(authId);
    }

    return tokenData?.id_token;
  }
}
