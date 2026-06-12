import { CURL_TOOL } from "./external-tools/defs/curl";
import { resolveExternalBinary } from "./external-tools/resolve-binary";

function embedCurlCompileFlag(): boolean {
  try {
    // Injected by `bun build --define`; absent when running tests / plain `bun`.
    return __KULALA_EMBED_CURL__ === true;
  } catch {
    return false;
  }
}

async function tryEmbedCurl(): Promise<{
  bytes: Buffer;
  filename: string;
  licenseBytes?: Buffer;
} | null> {
  // Single-file `bun build --compile` only: embed curl for the *build* target.
  // The npm library build sets __KULALA_EMBED_CURL__=false so nothing is embedded.
  if (!embedCurlCompileFlag() || typeof Bun === "undefined") return null;
  try {
    const embedHref = new URL(
      "./vendored-curl.embed.generated.ts",
      import.meta.url,
    ).href;
    const mod = (await import(embedHref)) as {
      getVendoredCurl?: () => Promise<{
        bytes: Buffer;
        filename: string;
        licenseBytes?: Buffer;
      } | null>;
    };
    if (typeof mod.getVendoredCurl === "function") {
      return await mod.getVendoredCurl();
    }
  } catch {
    // optional module (gitignored until generate-vendored-curl runs)
  }
  return null;
}

export async function resolveCurlPath(): Promise<string> {
  return resolveExternalBinary(CURL_TOOL, { tryEmbed: tryEmbedCurl });
}
