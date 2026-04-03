import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalToolId } from "./types";

/**
 * Writes an embedded/packaged binary to a temp dir (used when Bun `--compile` ships bytes).
 */
export async function writeBundledToTemp(
  toolId: ExternalToolId,
  platformSubdir: string,
  bundled: { bytes: Buffer; filename: string },
): Promise<string> {
  const base = join(tmpdir(), "kulala-core", toolId, platformSubdir);
  await mkdir(base, { recursive: true });
  const target = join(base, bundled.filename);
  await writeFile(target, bundled.bytes, { mode: 0o755 });
  if (process.platform !== "win32") {
    await chmod(target, 0o755);
  }
  return target;
}
