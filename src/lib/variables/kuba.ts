import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";

const KUBA_YAML = "kuba.yaml";

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
 * Check if `kuba` is available in PATH.
 */
export function isKubaInPath(): boolean {
  const which = typeof Bun !== "undefined" ? Bun.which?.("kuba") : null;
  if (which) return true;
  const result = spawnSync("which", ["kuba"], { encoding: "utf8" });
  return result.status === 0;
}

/**
 * Run `kuba show --contain --env <env> --output json` in dir and return parsed env vars.
 * Returns null if kuba.yaml not in dir, kuba not in PATH, or command fails.
 * If kuba.yaml exists but kuba is not in PATH, writes a message to stderr.
 */
export function getKubaEnv(
  env: string,
  dir: string,
): Record<string, string> | null {
  if (!existsSync(join(dir, KUBA_YAML))) {
    return null;
  }
  if (!isKubaInPath()) {
    Bun.stderr.write(
      new TextEncoder().encode(
        "kulala-core: kuba.yaml found but 'kuba' is not in PATH. Install kuba or add it to PATH.\n",
      ),
    );
    return null;
  }
  const result = spawnSync(
    "kuba",
    ["show", "--contain", "--env", env, "--output", "json"],
    { encoding: "utf8", cwd: dir, stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0 || result.stdout == null) {
    return null;
  }
  try {
    const data = JSON.parse(result.stdout.trim()) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        out[k] = String(v);
      }
    }
    return out;
  } catch {
    return null;
  }
}
