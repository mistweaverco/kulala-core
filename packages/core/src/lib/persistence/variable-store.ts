import type { KulalaVariable } from "../parser/types/variable";
import { getDb } from "./db";

export type VariableScope = "global" | "document" | "request";

function scopeDocument(scope: VariableScope, document?: string): string {
  if (scope === "global") return "";
  return document ?? "";
}

function scopeBlock(scope: VariableScope, blockName?: string): string {
  if (scope === "global" || scope === "document") return "";
  return blockName ?? "";
}

/**
 * Set a variable. Value is JSON-serialized.
 * - global: document and blockName ignored
 * - document: document required, blockName ignored
 * - request: document and blockName required
 */
export function setVariable(
  scope: VariableScope,
  name: string,
  value: KulalaVariable[string] | Record<string, unknown>,
  options?: { document?: string; blockName?: string },
): void {
  const db = getDb();
  const doc = scopeDocument(scope, options?.document);
  const block = scopeBlock(scope, options?.blockName);
  const valueJson = JSON.stringify(value);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO variables (scope, name, value_json, scope_document, scope_block_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, name, scope_document, scope_block_name) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    [scope, name, valueJson, doc, block, now],
  );
}

/**
 * Get a variable by scope and name. Returns undefined if not found.
 */
export function getVariable(
  scope: VariableScope,
  name: string,
  options?: { document?: string; blockName?: string },
): KulalaVariable[string] | Record<string, unknown> | undefined {
  const db = getDb();
  const doc = scopeDocument(scope, options?.document);
  const block = scopeBlock(scope, options?.blockName);

  const row = db
    .query<
      { value_json: string },
      [string, string, string, string]
    >("SELECT value_json FROM variables WHERE scope = ? AND name = ? AND scope_document = ? AND scope_block_name = ?")
    .get(scope, name, doc, block);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json) as
      | KulalaVariable[string]
      | Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Get all variables for a scope (e.g. all global vars, or all vars for a document).
 */
export function getVariables(
  scope: VariableScope,
  options?: { document?: string; blockName?: string },
): Record<string, KulalaVariable[string] | Record<string, unknown>> {
  const db = getDb();
  const doc = scopeDocument(scope, options?.document);
  const block = scopeBlock(scope, options?.blockName);

  const rows = db
    .query<
      { name: string; value_json: string },
      [string, string, string]
    >("SELECT name, value_json FROM variables WHERE scope = ? AND scope_document = ? AND scope_block_name = ?")
    .all(scope, doc, block);

  const out: Record<string, KulalaVariable[string] | Record<string, unknown>> =
    {};
  for (const r of rows) {
    try {
      out[r.name] = JSON.parse(r.value_json) as
        | KulalaVariable[string]
        | Record<string, unknown>;
    } catch {
      // skip invalid
    }
  }
  return out;
}

/**
 * Delete a variable.
 */
export function deleteVariable(
  scope: VariableScope,
  name: string,
  options?: { document?: string; blockName?: string },
): boolean {
  const db = getDb();
  const doc = scopeDocument(scope, options?.document);
  const block = scopeBlock(scope, options?.blockName);
  const result = db.run(
    "DELETE FROM variables WHERE scope = ? AND name = ? AND scope_document = ? AND scope_block_name = ?",
    [scope, name, doc, block],
  );
  return (result as { changes: number }).changes > 0;
}
