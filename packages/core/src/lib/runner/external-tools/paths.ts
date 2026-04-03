import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root directory for persisted kulala-core data (binaries, caches).
 * Cross-platform defaults:
 * - Linux: `$XDG_DATA_HOME/kulala-core` or `~/.local/share/kulala-core`
 * - macOS: `~/Library/Application Support/kulala-core`
 * - Windows: `%LOCALAPPDATA%\\kulala-core`
 */
export function getKulalaCoreDataDir(): string {
  const explicit = process.env.KULALA_CORE_DATA_DIR;
  if (explicit) return explicit;

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) return join(local, "kulala-core");
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "kulala-core");
    const profile = process.env.USERPROFILE;
    if (profile) return join(profile, "kulala-core");
    return join(homedir(), "kulala-core");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "kulala-core");
  }

  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) return join(xdgData, "kulala-core");

  return join(homedir(), ".local", "share", "kulala-core");
}

/**
 * Directory where downloaded tool binaries live, e.g.
 * `~/.local/share/kulala-core/cache/curl/linux-x64/curl`.
 */
export function getKulalaCoreCacheRoot(): string {
  const explicit = process.env.KULALA_CORE_CACHE_DIR;
  if (explicit) return explicit;
  return join(getKulalaCoreDataDir(), "cache");
}

/**
 * Per-tool directory containing `<platform>-<arch>/` folders.
 * Honors `KULALA_CORE_CURL_CACHE_DIR` for curl only (legacy: that var pointed at the
 * old `…/kulala` parent, with curl under `…/kulala/curl/`).
 */
export function getToolInstallRoot(toolId: string): string {
  const legacy = process.env.KULALA_CORE_CURL_CACHE_DIR;
  if (legacy && toolId === "curl") {
    return join(legacy, "curl");
  }
  return join(getKulalaCoreCacheRoot(), toolId);
}
