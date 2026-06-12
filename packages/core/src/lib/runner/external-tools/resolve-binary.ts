import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { writeBundledToTemp } from "./bundled-extract";
import {
  downloadAndVerifyArchiveToExe,
  downloadAndVerifyBinaryToExe,
} from "./download";
import { getToolInstallRoot } from "./paths";
import type { ExternalToolDefinition, PlatformArchKey } from "./types";

const execFileAsync = promisify(execFile);

export function resolvePlatformVendorSubdir(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

async function fileIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function downloadKey(
  def: ExternalToolDefinition,
  platform: NodeJS.Platform,
  arch: string,
): PlatformArchKey {
  return `${platform}-${arch}` as PlatformArchKey;
}

async function resolveOnSystemPath(
  commandNames: string[],
): Promise<string | null> {
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    for (const cmd of commandNames) {
      const p = Bun.which(cmd);
      if (p) return p;
    }
  }

  for (const cmd of commandNames) {
    try {
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync("where.exe", [cmd], {
          encoding: "utf8",
        });
        const line = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean);
        if (line && (await fileIsExecutable(line))) return line;
      } else {
        const { stdout } = await execFileAsync(
          "sh",
          ["-c", `command -v '${cmd.replace(/'/g, "'\\''")}'`],
          { encoding: "utf8" },
        );
        const line = stdout.trim();
        if (line && (await fileIsExecutable(line))) return line;
      }
    } catch {
      // try next name
    }
  }
  return null;
}

export type ResolveExternalBinaryOptions = {
  /**
   * When false (e.g. embedding a known-good binary at build time), skip resolving `curl` from PATH.
   * @default true
   */
  allowSystemFallback?: boolean;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Bun embed / packaged fallback: runs after cache miss, before download. */
  tryEmbed?: () => Promise<{ bytes: Buffer; filename: string } | null>;
};

const resolvedMemo = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function memoKey(
  def: ExternalToolDefinition,
  platform: NodeJS.Platform,
  arch: string,
  allowSystem: boolean,
): string {
  return `${def.id}:${platform}:${arch}:${allowSystem ? "1" : "0"}`;
}

/**
 * Resolves an external tool binary: explicit env → user cache → optional embed →
 * PATH (if allowed) → pinned download.
 * TODO: Extend with new definitions for grpcurl, websocat, etc.
 */
export async function resolveExternalBinary(
  def: ExternalToolDefinition,
  options: ResolveExternalBinaryOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const allowSystem = options.allowSystemFallback !== false;
  const key = memoKey(def, platform, arch, allowSystem);
  const hit = resolvedMemo.get(key);
  if (hit && (await fileIsExecutable(hit))) return hit;
  if (hit) resolvedMemo.delete(key);

  const existing = inflight.get(key);
  if (existing) return existing;

  const run = (async () => {
    const explicit = process.env[def.pathEnvVar];
    if (explicit && (await fileIsExecutable(explicit))) {
      return explicit;
    }

    const subdir = resolvePlatformVendorSubdir(platform, arch);
    const cached = join(
      getToolInstallRoot(def.id),
      subdir,
      def.binaryFileName(platform),
    );
    if (await fileIsExecutable(cached)) return cached;

    const embedded = options.tryEmbed ? await options.tryEmbed() : null;
    if (embedded) {
      const p = await writeBundledToTemp(def.id, subdir, embedded);
      if (await fileIsExecutable(p)) return p;
    }

    if (allowSystem) {
      const sys = await resolveOnSystemPath(def.systemCommandNames);
      if (sys) return sys;
    }

    const binarySpec =
      def.binaryDownloadsByPlatform?.[downloadKey(def, platform, arch)];
    if (binarySpec) {
      try {
        await downloadAndVerifyBinaryToExe(binarySpec, cached, def.userAgent);
        if (await fileIsExecutable(cached)) return cached;
      } catch {
        // fall through
      }
    }

    const spec = def.downloadsByPlatform?.[downloadKey(def, platform, arch)];
    if (spec) {
      try {
        await downloadAndVerifyArchiveToExe(spec, cached, def.userAgent);
        if (await fileIsExecutable(cached)) return cached;
      } catch {
        // fall through
      }
    }

    const where = cached;
    const hint = allowSystem
      ? `Tried env, cache, embed, PATH, and download to ${where}. Install ${def.id} or set ${def.pathEnvVar}.`
      : `Tried download to ${where}. Ensure the tool is cached or set ${def.pathEnvVar}.`;
    throw new Error(`Could not resolve ${def.id} binary. ${hint}`);
  })();

  inflight.set(key, run);
  try {
    const path = await run;
    resolvedMemo.set(key, path);
    return path;
  } finally {
    inflight.delete(key);
  }
}
