import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { isSharedBlockName } from "../shared-blocks";
type BlockWithRunMeta = KulalaBlock & {
  __fileRunExpander?: boolean;
  __runParentBlock?: string;
  __runDirectiveLine?: number;
};

/** Skip wrapper blocks that only expand to `run ./file.http` targets. */
export function filterExecutableBlocks(blocks: KulalaBlock[]): KulalaBlock[] {
  return blocks.filter((b) => {
    const meta = b as BlockWithRunMeta;
    if (meta.__fileRunExpander) return false;
    // KULALA_SHARED* HTTP runs via hooks before other blocks (see doRequest.ts).
    if (isSharedBlockName(b.name)) return false;
    return true;
  });
}

/** Expand a file-run wrapper or top-level run selection into concrete request blocks. */
export function resolveBlocksToRun(
  doc: KulalaDocument,
  selected: KulalaBlock | KulalaBlock[],
): KulalaBlock[] {
  const out: KulalaBlock[] = [];
  for (const block of Array.isArray(selected) ? selected : [selected]) {
    const meta = block as BlockWithRunMeta;
    if (meta.__fileRunExpander) {
      out.push(
        ...doc.blocks.filter((b) => {
          const child = b as BlockWithRunMeta;
          return child.__runParentBlock === block.name;
        }),
      );
    } else {
      out.push(block);
    }
  }
  return out;
}

export function findBlockAtCursor(
  doc: KulalaDocument,
  cursorPosition: { line: number; column: number },
): KulalaBlock | null {
  // Adjust cursor position: block positions are relative to contentWithoutDirectives,
  // but cursor position is relative to the original file (with directives)
  const directiveLinesRemoved = doc.directiveLinesRemoved ?? 0;
  const adjustedLine = cursorPosition.line - directiveLinesRemoved;

  // Only search native blocks (blocks from the current file, not imported/run blocks)
  // Native blocks are the first nativeBlockCount blocks
  const nativeBlockCount = doc.nativeBlockCount ?? doc.blocks.length;
  const nativeBlocks = doc.blocks.slice(0, nativeBlockCount);

  // If adjusted line is before the first block, return null
  if (adjustedLine < 1) {
    return null;
  }

  for (const block of nativeBlocks) {
    if (
      block.position.start <= adjustedLine &&
      block.position.end >= adjustedLine
    ) {
      return block;
    }
  }
  return null;
}

/**
 * Blocks to execute for a cursor position, including `run ./file.http` expansion.
 */
export function findBlocksAtCursor(
  doc: KulalaDocument,
  cursorPosition: { line: number; column: number },
): KulalaBlock[] {
  const native = findBlockAtCursor(doc, cursorPosition);
  if (native) {
    return resolveBlocksToRun(doc, native);
  }

  // Cursor on a top-level `run ./file.http` directive line (1-based file line).
  for (const directive of doc.directives) {
    if (directive.type !== "run") continue;
    const target = directive.target.trim();
    if (target.startsWith("#")) continue;
    if (cursorPosition.line !== directive.lineNumber + 1) continue;
    return doc.blocks.filter((b) => {
      const meta = b as BlockWithRunMeta;
      return (
        meta.__runDirectiveLine === directive.lineNumber &&
        meta.__runParentBlock === undefined
      );
    });
  }

  return [];
}
