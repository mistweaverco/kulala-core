import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { findBlocksAtCursor } from "../runner/block";
import { getEffectiveOperators } from "../runner/effective-operators";

export function blockHasOpenAPIOperator(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
): boolean {
  const operators = getEffectiveOperators(doc, block);
  return operators.some((o) => o.name === "kulala-openapi-json");
}

export function openAPIBlockFromCursor(
  doc: KulalaDocument,
  line: number,
  column: number,
): KulalaBlock | undefined {
  const blocks = findBlocksAtCursor(doc, { line, column });
  const block = blocks[0];
  if (!block || !blockHasOpenAPIOperator(doc, block)) return undefined;
  return block;
}
