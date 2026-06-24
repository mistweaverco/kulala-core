import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  dirsUpward,
  loadHttpClientEnvJsonRaw,
} from "../../variables/env-files";
import type { AuthConfig, MockConfig, OAuth2Config } from "./types";
import { isMockConfig, isOAuth2Config } from "./types";

const HTTP_CLIENT_ENV_JSON = "http-client.env.json";
const HTTP_CLIENT_PRIVATE_ENV_JSON = "http-client.private.env.json";

function isAuthConfigEntry(config: unknown): config is AuthConfig {
  if (typeof config !== "object" || config === null) return false;
  const type = (config as { Type?: unknown }).Type;
  return type === "OAuth2" || type === "Mock";
}

function mergeAuthConfig(
  existing: AuthConfig | undefined,
  patch: AuthConfig | Record<string, unknown>,
): AuthConfig {
  if (existing) {
    return { ...existing, ...patch } as AuthConfig;
  }
  if (isAuthConfigEntry(patch)) {
    return patch;
  }
  return patch as unknown as AuthConfig;
}

/**
 * Load Security.Auth configs from http-client.env.json and http-client.private.env.json.
 * Supports OAuth2 and Mock types. Private entries override public (closest wins).
 */
export function loadAuthConfigs(
  env: string,
  startDir: string,
): Map<string, AuthConfig> {
  const configs = new Map<string, AuthConfig>();
  const dirs = dirsUpward(startDir);

  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_ENV_JSON);
    if (!existsSync(p)) continue;
    const section = loadHttpClientEnvJsonRaw(p, env);
    if (!section) continue;
    const security = section.Security;
    if (typeof security !== "object" || security === null) continue;
    const auth = (security as Record<string, unknown>).Auth;
    if (typeof auth !== "object" || auth === null) continue;
    for (const [authId, config] of Object.entries(auth)) {
      if (isAuthConfigEntry(config)) {
        configs.set(authId, mergeAuthConfig(configs.get(authId), config));
      }
    }
  }

  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_PRIVATE_ENV_JSON);
    if (!existsSync(p)) continue;
    const section = loadHttpClientEnvJsonRaw(p, env);
    if (!section) continue;
    const security = section.Security;
    if (typeof security !== "object" || security === null) continue;
    const auth = (security as Record<string, unknown>).Auth;
    if (typeof auth !== "object" || auth === null) continue;
    for (const [authId, config] of Object.entries(auth)) {
      if (typeof config !== "object" || config === null) continue;
      const patch = config as Record<string, unknown>;
      const type = patch.Type;
      const existing = configs.get(authId);
      const isOAuth2Entry = type === "OAuth2";
      const isMockEntry = type === "Mock";
      const hasExistingOAuth2 =
        existing !== undefined && isOAuth2Config(existing);
      const hasExistingMock = existing !== undefined && isMockConfig(existing);
      if (
        isOAuth2Entry ||
        isMockEntry ||
        hasExistingOAuth2 ||
        hasExistingMock
      ) {
        configs.set(authId, mergeAuthConfig(existing, patch));
      }
    }
  }

  return configs;
}

/**
 * Load OAuth2 configs from http-client.env.json and http-client.private.env.json.
 * Configs are merged (private overrides public).
 * Returns map of auth-id -> config.
 */
export function loadOAuth2Configs(
  env: string,
  startDir: string,
): Map<string, OAuth2Config> {
  const configs = new Map<string, OAuth2Config>();
  for (const [authId, config] of loadAuthConfigs(env, startDir)) {
    if (isOAuth2Config(config)) {
      configs.set(authId, config);
    }
  }
  return configs;
}

/**
 * Load Mock configs from http-client.env.json and http-client.private.env.json.
 */
export function loadMockConfigs(
  env: string,
  startDir: string,
): Map<string, MockConfig> {
  const configs = new Map<string, MockConfig>();
  for (const [authId, config] of loadAuthConfigs(env, startDir)) {
    if (isMockConfig(config)) {
      configs.set(authId, config);
    }
  }
  return configs;
}

/**
 * Load OAuth2 auth data (tokens) from http-client.private.env.json.
 */
export function loadOAuth2AuthData(
  env: string,
  startDir: string,
): Map<string, import("./types").OAuth2TokenData> {
  const tokens = new Map<string, import("./types").OAuth2TokenData>();
  const dirs = dirsUpward(startDir);

  // Load from http-client.private.env.json (closest wins)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_PRIVATE_ENV_JSON);
    if (existsSync(p)) {
      const section = loadHttpClientEnvJsonRaw(p, env);
      if (section) {
        const authData = section.auth_data;
        if (typeof authData === "object" && authData !== null) {
          for (const [authId, tokenData] of Object.entries(authData)) {
            if (typeof tokenData === "object" && tokenData !== null) {
              tokens.set(
                authId,
                tokenData as import("./types").OAuth2TokenData,
              );
            }
          }
        }
      }
    }
  }

  return tokens;
}

/**
 * Save OAuth2 auth data (tokens) to http-client.private.env.json.
 * Creates file if it doesn't exist, updates existing file otherwise.
 */
export function saveOAuth2AuthData(
  env: string,
  startDir: string,
  authId: string,
  tokenData: import("./types").OAuth2TokenData,
): void {
  const dirs = dirsUpward(startDir);
  // Use closest directory that has http-client.private.env.json, or startDir if none
  let targetDir = startDir;
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_PRIVATE_ENV_JSON);
    if (existsSync(p)) {
      targetDir = dirs[i]!;
      break;
    }
  }

  const filePath = join(targetDir, HTTP_CLIENT_PRIVATE_ENV_JSON);
  let data: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, "utf8");
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // start fresh if parse fails
    }
  }

  if (typeof data !== "object" || data === null) {
    data = {};
  }

  if (!(env in data)) {
    data[env] = {};
  }
  let section = data[env] as Record<string, unknown>;
  if (typeof section !== "object" || section === null) {
    section = {};
    data[env] = section;
  }

  if (!("auth_data" in section)) {
    section.auth_data = {};
  }
  let authData = section.auth_data as Record<string, unknown>;
  if (typeof authData !== "object" || authData === null) {
    authData = {};
    section.auth_data = authData;
  }

  authData[authId] = tokenData;

  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
