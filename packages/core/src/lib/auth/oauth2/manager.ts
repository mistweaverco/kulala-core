import {
  loadAuthConfigs,
  loadOAuth2AuthData,
  saveOAuth2AuthData,
} from "./config";
import { substituteInString } from "../../variables/substitute";
import {
  acquireAuthorizationCodeToken,
  acquireClientCredentialsToken,
  acquireImplicitToken,
  acquirePasswordToken,
  isTokenExpired,
  refreshOAuth2Token,
} from "./acquisition";
import type {
  AuthConfig,
  MockConfig,
  OAuth2Config,
  OAuth2TokenData,
} from "./types";
import { isMockConfig, isOAuth2Config } from "./types";
import { OAuth2PromptError } from "./prompt-error";

function substituteConfigValue(
  value: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof value === "string") {
    return substituteInString(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteConfigValue(item, vars));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = substituteConfigValue(item, vars);
    }
    return out;
  }
  return value;
}

/** OAuth2 auth fields that may live only in http-client.private.env.json. */
const OAUTH2_PRIVATE_OVERRIDE_FIELDS = [
  "Client Secret",
  "Password",
  "Assertion",
  "private_key",
] as const;

/** Mock auth fields that may live only in http-client.private.env.json. */
const MOCK_PRIVATE_OVERRIDE_FIELDS = ["Token", "ID Token"] as const;

function enrichOAuth2ConfigFromEnvVars(
  authId: string,
  config: OAuth2Config,
  vars: Record<string, string>,
): OAuth2Config {
  const enriched = { ...config };
  for (const field of OAUTH2_PRIVATE_OVERRIDE_FIELDS) {
    const current = enriched[field];
    if (typeof current === "string" && current.length > 0) continue;
    const fromVars = vars[`Security.Auth.${authId}.${field}`];
    if (fromVars) {
      enriched[field] = fromVars;
    }
  }
  return enriched;
}

function enrichMockConfigFromEnvVars(
  authId: string,
  config: MockConfig,
  vars: Record<string, string>,
): MockConfig {
  const enriched = { ...config };
  for (const field of MOCK_PRIVATE_OVERRIDE_FIELDS) {
    const current = enriched[field];
    if (typeof current === "string" && current.length > 0) continue;
    const fromVars = vars[`Security.Auth.${authId}.${field}`];
    if (fromVars) {
      enriched[field] = fromVars;
    }
  }
  return enriched;
}

function enrichAuthConfigFromEnvVars(
  authId: string,
  config: AuthConfig,
  vars: Record<string, string>,
): AuthConfig {
  if (isOAuth2Config(config)) {
    return enrichOAuth2ConfigFromEnvVars(authId, config, vars);
  }
  return enrichMockConfigFromEnvVars(authId, config, vars);
}

/**
 * Load, substitute, and enrich one auth config entry.
 */
export function resolveAuthConfig(
  authId: string,
  env: string,
  startDir: string,
  substitutionVars: Record<string, string>,
): AuthConfig | undefined {
  const raw = loadAuthConfigs(env, startDir).get(authId);
  if (!raw) return undefined;
  const substituted = substituteConfigValue(
    raw,
    substitutionVars,
  ) as AuthConfig;
  return enrichAuthConfigFromEnvVars(authId, substituted, substitutionVars);
}

/**
 * Load, substitute, and enrich one OAuth2 config entry.
 */
export function resolveOAuth2Config(
  authId: string,
  env: string,
  startDir: string,
  substitutionVars: Record<string, string>,
): OAuth2Config | undefined {
  const config = resolveAuthConfig(authId, env, startDir, substitutionVars);
  return config && isOAuth2Config(config) ? config : undefined;
}

/**
 * Auth token manager for Security.Auth profiles (OAuth2 and Mock).
 * Handles token acquisition, refresh, and storage for OAuth2.
 */
export class OAuth2Manager {
  private configs: Map<string, AuthConfig> = new Map();
  private tokens: Map<string, OAuth2TokenData> = new Map();
  private env: string;
  private startDir: string;
  private substitutionVars: Record<string, string>;

  constructor(
    env: string,
    startDir: string,
    substitutionVars: Record<string, string>,
  ) {
    this.env = env;
    this.startDir = startDir;
    this.substitutionVars = substitutionVars;
    this.loadConfigs();
    this.loadTokens();
  }

  private loadConfigs(): void {
    this.configs = new Map();
    const rawConfigs = loadAuthConfigs(this.env, this.startDir);
    for (const authId of rawConfigs.keys()) {
      const raw = rawConfigs.get(authId);
      if (!raw) continue;
      const substituted = substituteConfigValue(
        raw,
        this.substitutionVars,
      ) as AuthConfig;
      this.configs.set(
        authId,
        enrichAuthConfigFromEnvVars(authId, substituted, this.substitutionVars),
      );
    }
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

    if (isMockConfig(config)) {
      if (config.Token) return config.Token;
      const cached = this.tokens.get(authId)?.access_token;
      return cached;
    }

    return this.getOAuth2AccessToken(authId, config);
  }

  /**
   * Get ID token for auth-id.
   */
  async getIdToken(authId: string): Promise<string | undefined> {
    const config = this.configs.get(authId);
    if (!config) {
      return undefined;
    }

    if (isMockConfig(config)) {
      return config["ID Token"];
    }

    let tokenData = this.tokens.get(authId);

    // Ensure we have a valid token
    if (!tokenData || isTokenExpired(tokenData)) {
      await this.getOAuth2AccessToken(authId, config);
      tokenData = this.tokens.get(authId);
    }

    return tokenData?.id_token;
  }

  private async getOAuth2AccessToken(
    authId: string,
    config: OAuth2Config,
  ): Promise<string | undefined> {
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

    if (config["Use ID Token"]) {
      return tokenData.id_token ?? tokenData.access_token;
    }

    return tokenData.access_token;
  }
}
