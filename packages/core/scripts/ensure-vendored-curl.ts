import { chmod, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

type Platform = "linux" | "darwin" | "win32";
type Arch = "x64" | "arm64";

const CURL_VERSION = "8.19.0";

type DownloadSpec = {
  url: string;
  expectedSha256: string;
  archiveExeName: string;
};

// Source: https://curl.se/download.html -> "Packages" table (prebuilt binaries by providers).
// We pin to a fixed version and hard-code URLs + SHA256 for reproducibility.
const DOWNLOAD_SPECS: Record<string, DownloadSpec> = {
  "linux-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-linux-x86_64-musl-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "3c5c62815d4a12bebd10c2884038d68102c81e5c058eaad1b3c3e66343634152",
    archiveExeName: "curl",
  },
  "linux-arm64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-linux-aarch64-musl-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "c60f5718765bfc83bff10e7aa8eada2e629e009738b38683164a19482dd43a53",
    archiveExeName: "curl",
  },
  "darwin-arm64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-macos-arm64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "210adf449293bb55e86a7ce26e32a8b00e7fafec570c24d2fe82bec3ff4ac090",
    archiveExeName: "curl",
  },
  "darwin-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-macos-x86_64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "732a165fd450f12bbb01170bb99a6cd00b904d1eeccbe5ecd3e25220007d73f2",
    archiveExeName: "curl",
  },
  "win32-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-windows-x86_64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "40241a577f01e06d1ff31e9971fe5b188705f9a4ea9c26133eab237ed8c1528c",
    archiveExeName: "curl.exe",
  },
};

function platformVendorSubdir(): string {
  const plat = process.platform as Platform;
  const arch = process.arch as Arch;
  return `${plat}-${arch}`;
}

function exeName(): string {
  return process.platform === "win32" ? "curl.exe" : "curl";
}

function cacheBaseDir(): string {
  const explicit = process.env.KULALA_CORE_CURL_CACHE_DIR;
  if (explicit) return explicit;

  // Respect XDG on any platform if explicitly set.
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "kulala");

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return join(localAppData, "kulala");
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "kulala");
    const userProfile = process.env.USERPROFILE;
    if (userProfile) return join(userProfile, ".cache", "kulala");
    return join(homedir(), ".cache", "kulala");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "kulala");
  }

  // Linux and other unix-likes.
  return join(homedir(), ".cache", "kulala");
}

async function fileIsExecutable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function downloadSpec(): DownloadSpec {
  const plat = process.platform as Platform;
  const arch = process.arch as Arch;
  const key = `${plat}-${arch}`;
  const spec = DOWNLOAD_SPECS[key];
  if (!spec) {
    throw new Error(
      `Unsupported platform/arch for automatic curl download: ${key}`,
    );
  }
  return spec;
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "kulala-core(postinstall)",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength < 1024 * 64) {
    // sanity check: a curl binary shouldn't be tiny (avoids saving HTML error pages)
    throw new Error(`Downloaded file too small (${buf.byteLength} bytes)`);
  }
  return buf;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function extractTarXz(
  archivePath: string,
  outDir: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xJf", archivePath, "-C", outDir], {
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const exe = exeName();
  const subdir = platformVendorSubdir();
  const targetDir = join(cacheBaseDir(), "curl", subdir);
  const targetPath = join(targetDir, exe);

  if (await fileIsExecutable(targetPath)) return;

  await mkdir(targetDir, { recursive: true });
  const { url, expectedSha256, archiveExeName } = downloadSpec();

  try {
    const tmpBase = join(tmpdir(), `kulala-core-curl-${randomUUID()}`);
    await mkdir(tmpBase, { recursive: true });
    const archivePath = join(tmpBase, "curl.tar.xz");

    const archiveBytes = await download(url);
    await writeFile(archivePath, archiveBytes);

    await extractTarXz(archivePath, targetDir);

    const extractedPath = join(targetDir, archiveExeName);
    const extractedBytes = new Uint8Array(await readFile(extractedPath));
    const actualSha = sha256Hex(extractedBytes);
    if (actualSha !== expectedSha256) {
      throw new Error(
        `SHA256 mismatch for ${archiveExeName}: expected ${expectedSha256} got ${actualSha}`,
      );
    }

    // Ensure final name matches what runtime expects (curl / curl.exe).
    if (archiveExeName !== exe) {
      // Shouldn't happen with our mapping, but keep it safe.
      await writeFile(targetPath, extractedBytes, { mode: 0o755 });
    }

    if (process.platform !== "win32") {
      await chmod(targetPath, 0o755);
    }
    // Windows tar includes a CA bundle; keep it readable.
    // (No-op on other platforms if file isn't present.)
    try {
      const caPath = join(targetDir, "curl-ca-bundle.crt");
      await chmod(caPath, 0o644);
    } catch {
      // ignore
    }
    process.stderr.write(`kulala-core: downloaded curl to ${targetPath}\n`);

    await rm(tmpBase, { recursive: true, force: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `kulala-core: could not download vendored curl (${url}): ${msg}\n`,
    );
    process.stderr.write(
      `kulala-core: set KULALA_CURL_PATH to an existing curl.\n`,
    );
    process.exitCode = 1;
  }
}

await main();
