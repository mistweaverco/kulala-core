import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaOperator } from "../parser/types/operator";

/**
 * File-header operators merged with block operators; block wins on same operator name.
 */
export function getEffectiveOperators(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
): KulalaOperator[] {
  const docOps =
    block.sourceFileHeaderOperators ?? doc?.fileHeaderOperators ?? [];
  const byName = new Map<string, KulalaOperator>();
  for (const op of docOps) byName.set(op.name, op);
  for (const op of block.operators) byName.set(op.name, op);
  return [...byName.values()];
}
