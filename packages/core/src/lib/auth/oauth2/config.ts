import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  dirsUpward,
  loadHttpClientEnvJsonRaw,
} from "../../variables/env-files";
import type { OAuth2Config } from "./types";

const HTTP_CLIENT_ENV_JSON = "http-client.env.json";
const HTTP_CLIENT_PRIVATE_ENV_JSON = "http-client.private.env.json";

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
  const dirs = dirsUpward(startDir);

  // Load from http-client.env.json (public configs)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_ENV_JSON);
    if (existsSync(p)) {
      const section = loadHttpClientEnvJsonRaw(p, env);
      if (section) {
        const security = section.Security;
        if (typeof security === "object" && security !== null) {
          const auth = (security as Record<string, unknown>).Auth;
          if (typeof auth === "object" && auth !== null) {
            for (const [authId, config] of Object.entries(auth)) {
              if (
                typeof config === "object" &&
                config !== null &&
                (config as { Type?: unknown }).Type === "OAuth2"
              ) {
                configs.set(authId, config as OAuth2Config);
              }
            }
          }
        }
      }
    }
  }

  // Load from http-client.private.env.json (private configs override public)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_PRIVATE_ENV_JSON);
    if (existsSync(p)) {
      const section = loadHttpClientEnvJsonRaw(p, env);
      if (section) {
        const security = section.Security;
        if (typeof security === "object" && security !== null) {
          const auth = (security as Record<string, unknown>).Auth;
          if (typeof auth === "object" && auth !== null) {
            for (const [authId, config] of Object.entries(auth)) {
              if (
                typeof config === "object" &&
                config !== null &&
                (config as { Type?: unknown }).Type === "OAuth2"
              ) {
                // Merge with existing config (private overrides)
                const existing = configs.get(authId);
                configs.set(authId, {
                  ...existing,
                  ...(config as OAuth2Config),
                } as OAuth2Config);
              }
            }
          }
        }
      }
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
