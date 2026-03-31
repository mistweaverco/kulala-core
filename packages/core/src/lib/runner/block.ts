import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";

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
