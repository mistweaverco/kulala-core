import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

async function tryResolveCachedCurl(): Promise<string | null> {
  const exe = process.platform === "win32" ? "curl.exe" : "curl";
  const cached = join(cacheBaseDir(), "curl", platformVendorSubdir(), exe);
  if (await fileIsExecutable(cached)) return cached;
  return null;
}

async function tryResolveBundledCurl(): Promise<{
  bytes: Buffer;
  filename: string;
} | null> {
  // Single-file `bun build --compile` only: embed curl for the *build* target.
  // The npm library build sets __KULALA_EMBED_CURL__=false so we never ship a
  // publisher-machine curl; consumers get curl via postinstall → cache, or they
  // run generate-vendored-curl.ts before compiling their own binary.
  if (__KULALA_EMBED_CURL__ === true && typeof Bun !== "undefined") {
    try {
      // Optional module: created only by packages/core/scripts/generate-vendored-curl.ts (gitignored).
      // Listed in tsconfig exclude; use URL + import(href) so tsc does not require the file for declaration emit (CI has no generated .ts).
      // Bun still resolves the relative path for bundling.
      const embedHref = new URL(
        "./vendored-curl.embed.generated.ts",
        import.meta.url,
      ).href;
      const mod = (await import(embedHref)) as {
        getVendoredCurl?: () => Promise<{
          bytes: Buffer;
          filename: string;
        } | null>;
      };
      if (typeof mod.getVendoredCurl === "function") {
        const res = await mod.getVendoredCurl();
        if (res) return res;
      }
    } catch {
      // ignore; fall back to filesystem-based lookup
    }
  }

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

  const cached = await tryResolveCachedCurl();
  if (cached) return cached;

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
    "Could not resolve vendored curl. Run the package postinstall (or bun run ./scripts/ensure-vendored-curl.ts from @mistweaverco/kulala-core), place curl under vendor/curl/<platform>-<arch>/, or set KULALA_CURL_PATH.",
  );
}
