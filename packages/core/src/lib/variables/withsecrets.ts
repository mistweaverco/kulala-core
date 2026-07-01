import { existsSync } from "fs";
import { dirname, join } from "path";
import { flattenToDotPaths } from "./flatten-json";

/** Matches withsecrets config discovery order (ws.yaml → withsecrets.yaml → kuba.yaml). */
const CONFIG_FILE_NAMES = ["ws.yaml", "withsecrets.yaml", "kuba.yaml"] as const;

const CLI_BINARIES = ["ws", "kuba"] as const;

const WITHSECRETS_SPAWN_TIMEOUT_MS = 10_000;

export type WithsecretsCliBinary = (typeof CLI_BINARIES)[number];

/**
 * Traverse upward from startDir to find a directory containing a withsecrets config file.
 */
export function findWithsecretsYamlDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    for (const name of CONFIG_FILE_NAMES) {
      if (existsSync(join(dir, name))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** @deprecated Use {@link findWithsecretsYamlDir}. */
export const findKubaYamlDir = findWithsecretsYamlDir;

function hasConfigFile(dir: string): boolean {
  return CONFIG_FILE_NAMES.some((name) => existsSync(join(dir, name)));
}

/**
 * Prefer `ws`, then legacy `kuba` compatibility binary.
 */
export function resolveWithsecretsCli(): WithsecretsCliBinary | null {
  for (const name of CLI_BINARIES) {
    if (Bun.which(name) != null) {
      return name;
    }
  }
  return null;
}

/**
 * Check if `ws` or `kuba` is available in PATH.
 */
export function isWithsecretsInPath(): boolean {
  return resolveWithsecretsCli() != null;
}

/** @deprecated Use {@link isWithsecretsInPath}. */
export const isKubaInPath = isWithsecretsInPath;

/**
 * List environment names via `ws show --env` (or `kuba show --env`).
 */
export async function listWithsecretsEnvNames(dir: string): Promise<string[]> {
  if (!hasConfigFile(dir)) {
    return [];
  }
  const cli = resolveWithsecretsCli();
  if (!cli) {
    return [];
  }
  const proc = Bun.spawn([cli, "show", "--env"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: WITHSECRETS_SPAWN_TIMEOUT_MS,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return [];
  }
  const text = await new Response(proc.stdout).text();
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @deprecated Use {@link listWithsecretsEnvNames}. */
export const listKubaEnvNames = listWithsecretsEnvNames;

/**
 * Run `ws show --env <env> --output json` in dir and return parsed env vars.
 * Returns null if no config file is in dir, CLI is not in PATH, or command fails.
 */
export async function getWithsecretsEnv(
  env: string,
  dir: string,
): Promise<Record<string, string> | null> {
  if (!hasConfigFile(dir)) {
    return null;
  }
  const cli = resolveWithsecretsCli();
  if (!cli) {
    return null;
  }
  const proc = Bun.spawn([cli, "show", "--env", env, "--output", "json"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: WITHSECRETS_SPAWN_TIMEOUT_MS,
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    return null;
  }
  try {
    const raw = await new Response(proc.stdout).text();
    const data = JSON.parse(raw.trim()) as unknown;
    if (typeof data !== "object" || data === null) return null;
    // Support both flat { VAR: "value" } and env-nested { "default": { VAR: "value" } }
    const source =
      typeof (data as Record<string, unknown>)[env] === "object" &&
      (data as Record<string, unknown>)[env] !== null
        ? ((data as Record<string, unknown>)[env] as Record<string, unknown>)
        : (data as Record<string, unknown>);
    const out: Record<string, string> = {};
    flattenToDotPaths(source, "", out);
    return out;
  } catch {
    return null;
  }
}

/** @deprecated Use {@link getWithsecretsEnv}. */
export const getKubaEnv = getWithsecretsEnv;
