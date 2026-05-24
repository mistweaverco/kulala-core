import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";

export function isVscodeRestclientCompatEnabled(
  doc: KulalaDocument,
  block: KulalaBlock,
): boolean {
  return (
    block.sourceVscodeRestclientCompat === true ||
    doc.vscodeRestclientCompat === true
  );
}
