import { existsSync } from "fs";
import { dirname, join } from "path";
import { flattenToDotPaths } from "./flatten-json";

const KUBA_YAML = "kuba.yaml";
const KUBA_SPAWN_TIMEOUT_MS = 10_000;

/**
 * Traverse upward from startDir to find a directory containing kuba.yaml.
 */
export function findKubaYamlDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, KUBA_YAML))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Check if `kuba` is available in PATH
 */
export function isKubaInPath(): boolean {
  return Bun.which("kuba") != null;
}

/**
 * List environment names from kuba.yaml via `kuba show --env` (no value).
 */
export async function listKubaEnvNames(dir: string): Promise<string[]> {
  if (!existsSync(join(dir, KUBA_YAML))) {
    return [];
  }
  if (!isKubaInPath()) {
    return [];
  }
  const proc = Bun.spawn(["kuba", "show", "--env"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: KUBA_SPAWN_TIMEOUT_MS,
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

/**
 * Run `kuba show --env <env> --output json` in dir and return parsed env vars.
 * Returns null if kuba.yaml not in dir, kuba not in PATH, or command fails.
 * If kuba.yaml exists but kuba is not in PATH, silently skips.
 */
export async function getKubaEnv(
  env: string,
  dir: string,
): Promise<Record<string, string> | null> {
  if (!existsSync(join(dir, KUBA_YAML))) {
    return null;
  }
  if (!isKubaInPath()) {
    return null;
  }
  const proc = Bun.spawn(["kuba", "show", "--env", env, "--output", "json"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: KUBA_SPAWN_TIMEOUT_MS,
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
