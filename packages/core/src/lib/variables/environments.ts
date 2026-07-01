import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  dirsUpward,
  HTTP_CLIENT_ENV_JSON,
  HTTP_CLIENT_PRIVATE_ENV_JSON,
} from "./env-files";
import { DEFAULT_CURL_OPTIONS_KEY } from "./default-curl-options";
import { DEFAULT_HEADERS_KEY, KULALA_SHARED_KEY } from "./default-headers";
import {
  findWithsecretsYamlDir,
  getWithsecretsEnv,
  isWithsecretsInPath,
  listWithsecretsEnvNames,
} from "./withsecrets";

export type KulalaEnvironmentCatalog = {
  /** Kulala-only: shared variables, `$kulalaDefaultHeaders`, and `$kulalaDefaultCurlOptions`. */
  $kulalaShared?: Record<string, unknown>;
  /** Environment name → variables (http-client sections + withsecrets flat vars). */
  environments: Record<string, Record<string, unknown>>;
};

const RESERVED_HTTP_CLIENT_KEYS = new Set(["$schema", KULALA_SHARED_KEY]);

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
  kulalaShared: Record<string, unknown>;
  environments: Record<string, Record<string, unknown>>;
} {
  const kulalaShared: Record<string, unknown> = {};
  const environments: Record<string, Record<string, unknown>> = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (!isPlainObject(data)) return { kulalaShared, environments };
    if (isPlainObject(data[KULALA_SHARED_KEY])) {
      Object.assign(kulalaShared, data[KULALA_SHARED_KEY]);
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
  return { kulalaShared, environments };
}

/**
 * Merge http-client.env.json and http-client.private.env.json from root → closest (closest wins).
 */
export function mergeHttpClientEnvCatalog(
  startDir: string,
): Pick<KulalaEnvironmentCatalog, "$kulalaShared" | "environments"> {
  const dirs = dirsUpward(startDir);
  let kulalaShared: Record<string, unknown> = {};
  const environments: Record<string, Record<string, unknown>> = {};

  for (const fileName of [
    HTTP_CLIENT_ENV_JSON,
    HTTP_CLIENT_PRIVATE_ENV_JSON,
  ] as const) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = join(dirs[i]!, fileName);
      if (!existsSync(p)) continue;
      const parsed = readHttpClientEnvFile(p);
      if (Object.keys(parsed.kulalaShared).length > 0) {
        kulalaShared = deepMergeObjects(kulalaShared, parsed.kulalaShared);
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
    $kulalaShared:
      Object.keys(kulalaShared).length > 0 ? kulalaShared : undefined,
    environments,
  };
}

/** Variables from `$kulalaShared`, excluding Kulala-only request defaults. */
export function kulalaSharedVariables(
  section: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!section) return {};
  const out: Record<string, unknown> = { ...section };
  delete out[DEFAULT_HEADERS_KEY];
  delete out[DEFAULT_CURL_OPTIONS_KEY];
  return out;
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
 * Discover environments from http-client.env.json, http-client.private.env.json, and ws.yaml.
 * Used by editors (kulala.nvim) for environment selection and preview.
 */
export async function loadEnvironmentCatalog(
  startDir: string,
): Promise<KulalaEnvironmentCatalog> {
  const http = mergeHttpClientEnvCatalog(startDir);
  const catalog: KulalaEnvironmentCatalog = {
    $kulalaShared: http.$kulalaShared,
    environments: { ...http.environments },
  };

  const withsecretsDir = findWithsecretsYamlDir(startDir);
  if (withsecretsDir !== null && isWithsecretsInPath()) {
    const names = await listWithsecretsEnvNames(withsecretsDir);
    for (const envName of names) {
      const vars = await getWithsecretsEnv(envName, withsecretsDir);
      if (!vars || Object.keys(vars).length === 0) continue;
      catalog.environments[envName] = deepMergeObjects(
        catalog.environments[envName] ?? {},
        flatVarsToSection(vars),
      );
    }
  }

  if (
    Object.keys(catalog.environments).length === 0 &&
    !catalog.$kulalaShared
  ) {
    catalog.environments.default = {};
  }

  return catalog;
}
