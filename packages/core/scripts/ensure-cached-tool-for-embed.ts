import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { getToolInstallRoot } from "../src/lib/runner/external-tools/paths.ts";
import { resolveExternalBinary } from "../src/lib/runner/external-tools/resolve-binary.ts";
import type { ExternalToolDefinition } from "../src/lib/runner/external-tools/types.ts";

function pathsEqual(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Resolves a tool binary (env, cache, or download) and ensures it exists at the
 * platform cache path used by `bun build --compile` file embeds.
 */
export async function ensureCachedToolForEmbed(
  def: ExternalToolDefinition,
  platform: NodeJS.Platform,
  arch: string,
): Promise<{ cacheDir: string; cachedExe: string }> {
  const resolvedPath = await resolveExternalBinary(def, {
    allowSystemFallback: false,
    platform,
    arch,
  });

  const subdir = `${platform}-${arch}`;
  const cacheDir = join(getToolInstallRoot(def.id), subdir);
  const cachedExe = join(cacheDir, def.binaryFileName(platform));
  mkdirSync(cacheDir, { recursive: true });

  if (!pathsEqual(resolvedPath, cachedExe)) {
    copyFileSync(resolvedPath, cachedExe);
    if (process.platform !== "win32") {
      chmodSync(cachedExe, 0o755);
    }
  }

  return { cacheDir, cachedExe: resolve(cachedExe) };
}
