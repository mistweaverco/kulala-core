import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { flattenToDotPaths } from "./flatten-json";

const HTTP_CLIENT_ENV_JSON = "http-client.env.json";
const HTTP_CLIENT_PRIVATE_ENV_JSON = "http-client.private.env.json";
const DOTENV = ".env";

/**
 * Collect directory paths from startDir upward to root.
 */
function dirsUpward(startDir: string): string[] {
  const dirs: string[] = [];
  let dir = startDir;
  for (;;) {
    dirs.push(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * Load and merge env section from one http-client.env.json or http-client.private.env.json.
 * Supports nested objects: values flattened to dotted paths (e.g. client.host.url, client.['host.url']).
 * Returns Record<string, string> for the given env key (e.g. "default", "dev").
 */
function loadHttpClientEnvJson(
  filePath: string,
  env: string,
): Record<string, string> {
  try {
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return {};
    const section = (data as Record<string, unknown>)[env];
    if (typeof section !== "object" || section === null) return {};
    const out: Record<string, string> = {};
    flattenToDotPaths(section, "", out);
    return out;
  } catch {
    return {};
  }
}

/**
 * Parse .env file content into Record<string, string>.
 * Lines are KEY=VALUE; supports basic unquoting.
 */
function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load environment variables from system, http-client.env.json, and .env.
 * Order (later overrides earlier): system env → http-client.env.json (merged from dirs upward, closest wins) → http-client.private.env.json → .env.
 * Also exposes system env as {{$env.VAR_NAME}} per JetBrains HTTP Client spec.
 * See https://www.jetbrains.com/help/idea/http-client-variables.html
 */
export function loadEnvVars(
  env: string,
  startDir: string,
): Record<string, string> {
  const out: Record<string, string> = {};

  // 1. System environment variables only as {{$env.VAR_NAME}} (JetBrains spec: not as plain {{USER}})
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out["$env." + k] = v;
  }

  const dirs = dirsUpward(startDir);

  // 2. http-client.env.json from root to closest (so closest wins)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_ENV_JSON);
    if (existsSync(p)) {
      const section = loadHttpClientEnvJson(p, env);
      for (const [k, v] of Object.entries(section)) out[k] = v;
    }
  }

  // 3. http-client.private.env.json (same merge order)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = join(dirs[i]!, HTTP_CLIENT_PRIVATE_ENV_JSON);
    if (existsSync(p)) {
      const section = loadHttpClientEnvJson(p, env);
      for (const [k, v] of Object.entries(section)) out[k] = v;
    }
  }

  // 4. .env (first found when walking from startDir up)
  for (const d of dirs) {
    const p = join(d, DOTENV);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf8");
        const parsed = parseDotEnv(content);
        for (const [k, v] of Object.entries(parsed)) out[k] = v;
      } catch {
        // ignore
      }
      break; // use closest .env only
    }
  }

  return out;
}
