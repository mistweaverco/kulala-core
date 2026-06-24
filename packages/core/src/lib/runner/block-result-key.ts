import type { KulalaBlock } from "../parser/types/block";

/** JetBrains `# @name REQUEST_ID` — key for {{REQUEST_ID.response...}} (falls back to `###` block name). */
export function getBlockResultKey(block: KulalaBlock): string {
  const nameOp = block.operators.find((o) => o.name === "name");
  const alias = nameOp?.args != null ? String(nameOp.args).trim() : "";
  return alias !== "" ? alias : block.name;
}
