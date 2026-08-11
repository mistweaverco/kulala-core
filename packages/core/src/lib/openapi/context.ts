import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { findBlocksAtCursor } from "../runner/block";
import { getEffectiveOperators } from "../runner/effective-operators";

export const OPENAPI_EXPLORER_OPERATOR = "kulala-openapi-explorer";
export const OPENAPI_NO_CACHE_OPERATOR = "kulala-openapi-no-cache";

export function isOpenAPIPanelOperatorName(name: string): boolean {
  return (
    name === OPENAPI_EXPLORER_OPERATOR || name === OPENAPI_NO_CACHE_OPERATOR
  );
}

export function blockHasOpenAPIOperator(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
): boolean {
  const operators = getEffectiveOperators(doc, block);
  return operators.some((o) => o.name === OPENAPI_EXPLORER_OPERATOR);
}

export function blockHasOpenAPINoCacheOperator(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
): boolean {
  const operators = getEffectiveOperators(doc, block);
  return operators.some((o) => o.name === OPENAPI_NO_CACHE_OPERATOR);
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
