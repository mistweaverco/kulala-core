import { constants as fsConstants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExternalToolId } from "./types";

export const VENDORED_LICENSE_FILENAME = "LICENSE";

function bundledLicenseSourcePath(toolId: ExternalToolId): string {
  const packageRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
  );
  return join(
    packageRoot,
    "scripts",
    "vendored-licenses",
    toolId,
    VENDORED_LICENSE_FILENAME,
  );
}

export async function readBundledLicense(
  toolId: ExternalToolId,
): Promise<Buffer | null> {
  try {
    return await readFile(bundledLicenseSourcePath(toolId));
  } catch {
    return null;
  }
}

/**
 * Writes the vendored tool LICENSE next to an extracted or downloaded binary when missing.
 */
export async function ensureVendoredLicense(
  toolId: ExternalToolId,
  targetDir: string,
  licenseBytes?: Buffer,
): Promise<void> {
  const licensePath = join(targetDir, VENDORED_LICENSE_FILENAME);
  try {
    await access(licensePath, fsConstants.F_OK);
    return;
  } catch {
    // write below
  }

  const bytes = licenseBytes ?? (await readBundledLicense(toolId));
  if (!bytes) return;

  await writeFile(licensePath, bytes, { mode: 0o644 });
}
