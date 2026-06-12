import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { ArchiveDownloadSpec, BinaryDownloadSpec } from "./types";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function downloadUrl(
  url: string,
  userAgent: string,
  minBytes = 1024 * 64,
): Promise<Uint8Array> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": userAgent },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < minBytes) {
    throw new Error(`Downloaded file too small (${buf.byteLength} bytes)`);
  }
  return buf;
}

/**
 * Downloads a single executable, verifies SHA-256, and writes it to `outExePath`.
 */
export async function downloadAndVerifyBinaryToExe(
  spec: BinaryDownloadSpec,
  outExePath: string,
  userAgent: string,
): Promise<void> {
  const targetDir = dirname(outExePath);
  await mkdir(targetDir, { recursive: true });
  const bytes = await downloadUrl(spec.url, userAgent, 1024 * 256);
  const actualSha = sha256Hex(bytes);
  if (actualSha !== spec.expectedSha256) {
    throw new Error(
      `SHA256 mismatch for ${basename(outExePath)}: expected ${spec.expectedSha256} got ${actualSha}`,
    );
  }
  await writeFile(outExePath, bytes, { mode: 0o755 });
  if (process.platform !== "win32") {
    await chmod(outExePath, 0o755);
  }
}

export async function extractTarXz(
  archivePath: string,
  outDir: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xJf", archivePath, "-C", outDir], {
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });
}

/**
 * Downloads a `.tar.xz` containing one main executable into the same directory as `outExePath`,
 * then verifies SHA-256 of the extracted binary. The final filename is `basename(outExePath)`.
 */
export async function downloadAndVerifyArchiveToExe(
  spec: ArchiveDownloadSpec,
  outExePath: string,
  userAgent: string,
): Promise<void> {
  const targetDir = dirname(outExePath);
  const finalName = basename(outExePath);
  await mkdir(targetDir, { recursive: true });
  const tmpBase = join(tmpdir(), `kulala-core-tool-${randomUUID()}`);
  await mkdir(tmpBase, { recursive: true });
  const archivePath = join(tmpBase, "archive.tar.xz");

  try {
    const archiveBytes = await downloadUrl(spec.url, userAgent);
    await writeFile(archivePath, archiveBytes);

    await extractTarXz(archivePath, targetDir);

    const extractedPath = join(targetDir, spec.archiveExeName);
    const extractedBytes = new Uint8Array(await readFile(extractedPath));
    const actualSha = sha256Hex(extractedBytes);
    if (actualSha !== spec.expectedSha256) {
      throw new Error(
        `SHA256 mismatch for ${spec.archiveExeName}: expected ${spec.expectedSha256} got ${actualSha}`,
      );
    }

    if (spec.archiveExeName !== finalName) {
      await writeFile(outExePath, extractedBytes, { mode: 0o755 });
    }

    if (process.platform !== "win32") {
      await chmod(outExePath, 0o755);
    }
    try {
      const caPath = join(targetDir, "curl-ca-bundle.crt");
      await chmod(caPath, 0o644);
    } catch {
      // ignore
    }
  } finally {
    await rm(tmpBase, { recursive: true, force: true });
  }
}
