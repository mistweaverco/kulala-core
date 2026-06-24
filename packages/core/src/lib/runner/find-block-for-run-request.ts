import { loadHttpDocument } from "../parser/parser";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";

export type FoundRunRequestBlock = {
  block: KulalaBlock;
  doc: KulalaDocument;
  filePath: string | undefined;
};

function findBlockByNameInDoc(
  doc: KulalaDocument,
  name: string,
): KulalaBlock | undefined {
  return doc.blocks.find((b) => b.name === name);
}

function nativeBlocks(doc: KulalaDocument): KulalaBlock[] {
  const count = doc.nativeBlockCount ?? doc.blocks.length;
  return doc.blocks.slice(0, count);
}

export async function findBlockForRunRequest(
  doc: KulalaDocument,
  name: string,
  currentFilePath: string | undefined,
  externalFilePath?: string,
): Promise<FoundRunRequestBlock> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("$kulala.runRequest: name must be a non-empty string");
  }

  const basePath = currentFilePath ?? doc.filepath;

  if (externalFilePath !== undefined) {
    const trimmedPath = externalFilePath.trim();
    if (trimmedPath.length === 0) {
      throw new Error(
        "$kulala.runRequest: filePath must be a non-empty string when provided",
      );
    }
    const loaded = await loadHttpDocument(trimmedPath, basePath);
    if ("errorMessage" in loaded) {
      throw new Error(`$kulala.runRequest: ${loaded.errorMessage}`);
    }
    const block = findBlockByNameInDoc(loaded, trimmedName);
    if (!block) {
      throw new Error(`$kulala.runRequest: block not found: ${trimmedName}`);
    }
    return { block, doc: loaded, filePath: loaded.filepath };
  }

  for (const directive of doc.directives) {
    if (directive.type !== "import") continue;
    const loaded = await loadHttpDocument(directive.filepath, basePath);
    if ("errorMessage" in loaded) continue;
    const block = findBlockByNameInDoc(loaded, trimmedName);
    if (block) {
      return { block, doc: loaded, filePath: loaded.filepath };
    }
  }

  const block = nativeBlocks(doc).find((b) => b.name === trimmedName);
  if (block) {
    return { block, doc, filePath: basePath };
  }

  throw new Error(`$kulala.runRequest: block not found: ${trimmedName}`);
}
