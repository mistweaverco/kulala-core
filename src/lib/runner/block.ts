import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";

export function findBlockAtCursor(
  doc: KulalaDocument,
  cursorPosition: { line: number; column: number },
): KulalaBlock | null {
  for (const block of doc.blocks) {
    if (
      block.position.start <= cursorPosition.line &&
      block.position.end >= cursorPosition.line
    ) {
      return block;
    }
  }
  return null;
}
