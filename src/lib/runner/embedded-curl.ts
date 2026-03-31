import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function fileIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function platformVendorSubdir(): string {
  // Release packaging should provide: vendor/curl/<platform>-<arch>/curl[.exe]
  const plat = process.platform;
  const arch = process.arch;
  return `${plat}-${arch}`;
}

async function tryResolveBundledCurl(): Promise<{
  bytes: Buffer;
  filename: string;
} | null> {
  // TODO:
  // make sure this gets bundled into the final build.
  // Some packagers don't like dynamic file URL reads,
  // so we may need to adjust this approach.
  const exe = process.platform === "win32" ? "curl.exe" : "curl";
  const assetUrl = new URL(
    `../../../vendor/curl/${platformVendorSubdir()}/${exe}`,
    import.meta.url,
  );
  try {
    // NOTE:
    // Some packagers don't like file URL reads; prefer a path when possible.
    const path = fileURLToPath(assetUrl);
    const bytes = await readFile(path);
    return { bytes, filename: exe };
  } catch {
    return null;
  }
}

export async function resolveCurlPath(): Promise<string> {
  const explicit = process.env.KULALA_CURL_PATH;
  if (explicit && (await fileIsExecutable(explicit))) return explicit;

  const bundled = await tryResolveBundledCurl();
  if (bundled) {
    const base = join(tmpdir(), "kulala", "curl", platformVendorSubdir());
    await mkdir(base, { recursive: true });
    const target = join(base, bundled.filename);
    try {
      // If already extracted and executable, reuse.
      if (await fileIsExecutable(target)) return target;
    } catch {
      // ignore
    }
    await writeFile(target, bundled.bytes, { mode: 0o755 });
    if (process.platform !== "win32") {
      await chmod(target, 0o755);
    }
    return target;
  }

  throw new Error(
    "Embedded curl is required but not bundled. Add vendor/curl/<platform>-<arch>/curl[.exe] to the build (or set KULALA_CURL_PATH explicitly).",
  );
}
