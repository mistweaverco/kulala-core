import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const KULALA_DIR = "kulala-core";

/**
 * Returns the OS-specific application data directory for Kulala Core.
 * - Linux: $XDG_DATA_HOME/kulala-core (fallback: ~/.local/share/kulala-core)
 * - macOS: ~/Library/Application Support/kulala-core
 * - Windows: %APPDATA%/kulala-core (e.g. C:\Users\<user>\AppData\Roaming\kulala-core)
 */
export function getDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const platform = process.platform;

  let base: string;
  if (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd"
  ) {
    base = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  } else if (platform === "darwin") {
    base = join(home, "Library", "Application Support");
  } else if (platform === "win32") {
    base = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  } else {
    base = join(home, ".local", "share");
  }

  return join(base, KULALA_DIR);
}

/**
 * Ensures the Kulala data directory exists and returns its path.
 */
export function ensureDataDir(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
