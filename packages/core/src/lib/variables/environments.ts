import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  dirsUpward,
  HTTP_CLIENT_ENV_JSON,
  HTTP_CLIENT_PRIVATE_ENV_JSON,
} from "./env-files";
import {
  findKubaYamlDir,
  getKubaEnv,
  isKubaInPath,
  listKubaEnvNames,
} from "./kuba";

export type KulalaEnvironmentCatalog = {
  /** Shared section merged from http-client.env.json files (JetBrains `$shared`). */
  $shared?: Record<string, unknown>;
  /** Environment name → variables (http-client sections + kuba flat vars). */
  environments: Record<string, Record<string, unknown>>;
};

const RESERVED_HTTP_CLIENT_KEYS = new Set(["$shared", "$schema"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) {
      out[k] = deepMergeObjects(prev, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readHttpClientEnvFile(filePath: string): {
  shared: Record<string, unknown>;
  environments: Record<string, Record<string, unknown>>;
} {
  const shared: Record<string, unknown> = {};
  const environments: Record<string, Record<string, unknown>> = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!isPlainObject(data)) return { shared, environments };
    if (isPlainObject(data.$shared)) {
      Object.assign(shared, data.$shared);
    }
    for (const [key, value] of Object.entries(data)) {
      if (RESERVED_HTTP_CLIENT_KEYS.has(key)) continue;
      if (isPlainObject(value)) {
        environments[key] = value;
      }
    }
  } catch {
    // ignore unreadable files
  }
  return { shared, environments };
}

/**
 * Merge http-client.env.json and http-client.private.env.json from root → closest (closest wins).
 */
export function mergeHttpClientEnvCatalog(
  startDir: string,
): Pick<KulalaEnvironmentCatalog, "$shared" | "environments"> {
  const dirs = dirsUpward(startDir);
  let shared: Record<string, unknown> = {};
  const environments: Record<string, Record<string, unknown>> = {};

  for (const fileName of [
    HTTP_CLIENT_ENV_JSON,
    HTTP_CLIENT_PRIVATE_ENV_JSON,
  ] as const) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = join(dirs[i]!, fileName);
      if (!existsSync(p)) continue;
      const parsed = readHttpClientEnvFile(p);
      if (Object.keys(parsed.shared).length > 0) {
        shared = deepMergeObjects(shared, parsed.shared);
      }
      for (const [envName, section] of Object.entries(parsed.environments)) {
        environments[envName] = deepMergeObjects(
          environments[envName] ?? {},
          section,
        );
      }
    }
  }

  return {
    $shared: Object.keys(shared).length > 0 ? shared : undefined,
    environments,
  };
}

function flatVarsToSection(
  vars: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    out[k] = v;
  }
  return out;
}

/**
 * Discover environments from http-client.env.json, http-client.private.env.json, and kuba.yaml.
 * Used by editors (kulala.nvim) for environment selection and preview.
 */
export async function loadEnvironmentCatalog(
  startDir: string,
): Promise<KulalaEnvironmentCatalog> {
  const http = mergeHttpClientEnvCatalog(startDir);
  const catalog: KulalaEnvironmentCatalog = {
    $shared: http.$shared,
    environments: { ...http.environments },
  };

  const kubaDir = findKubaYamlDir(startDir);
  if (kubaDir !== null && isKubaInPath()) {
    const names = await listKubaEnvNames(kubaDir);
    for (const envName of names) {
      const vars = await getKubaEnv(envName, kubaDir);
      if (!vars || Object.keys(vars).length === 0) continue;
      catalog.environments[envName] = deepMergeObjects(
        catalog.environments[envName] ?? {},
        flatVarsToSection(vars),
      );
    }
  }

  if (Object.keys(catalog.environments).length === 0 && !catalog.$shared) {
    catalog.environments.default = {};
  }

  return catalog;
}
