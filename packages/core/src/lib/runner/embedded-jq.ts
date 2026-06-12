import { JQ_TOOL } from "./external-tools/defs/jq";
import { resolveExternalBinary } from "./external-tools/resolve-binary";

function embedJqCompileFlag(): boolean {
  try {
    return __KULALA_EMBED_JQ__ === true;
  } catch {
    return false;
  }
}

async function tryEmbedJq(): Promise<{
  bytes: Buffer;
  filename: string;
} | null> {
  if (!embedJqCompileFlag() || typeof Bun === "undefined") return null;
  try {
    const embedHref = new URL(
      "./vendored-jq.embed.generated.ts",
      import.meta.url,
    ).href;
    const mod = (await import(embedHref)) as {
      getVendoredJq?: () => Promise<{
        bytes: Buffer;
        filename: string;
      } | null>;
    };
    if (typeof mod.getVendoredJq === "function") {
      return await mod.getVendoredJq();
    }
  } catch {
    // optional module (gitignored until generate-vendored-jq runs)
  }
  return null;
}

export async function resolveJqPath(): Promise<string> {
  return resolveExternalBinary(JQ_TOOL, { tryEmbed: tryEmbedJq });
}
