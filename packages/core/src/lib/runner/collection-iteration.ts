import type { KulalaBlock } from "../parser/types/block";
import { buildHeadersFromSection } from "./headers";

/** JetBrains: 0-based index of the current collection loop (0 = first request). */
export type CollectionIterationPlan = {
  count: number;
  /** Variable name → collection used for {{name}} expansion. */
  collections: Record<string, unknown[]>;
  /** First collection variable referenced in the request (for templateValue). */
  primaryCollection?: string;
};

const VAR_REF_RE = /\{\{\s*([^}]+)\s*\}\}/g;

function extractVariableRefsFromText(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(VAR_REF_RE)) {
    const name = m[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

function collectRefsFromBody(body: unknown): string[] {
  if (body == null) return [];
  if (typeof body === "string") return extractVariableRefsFromText(body);
  return extractVariableRefsFromText(JSON.stringify(body));
}

/** Parse a variable value as a JSON array collection (JetBrains collection variables). */
export function parseVariableCollection(
  value: string | undefined,
): unknown[] | null {
  if (value === undefined || value === "") return null;
  const t = value.trim();
  if (!t.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(t) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function collectionElementToSubstitutionValue(el: unknown): string {
  if (el == null) return "";
  if (typeof el === "string") return el;
  if (typeof el === "number" || typeof el === "boolean") return String(el);
  return JSON.stringify(el);
}

/**
 * Build per-iteration vars: collection variables are replaced with the element at index.
 */
export function varsForCollectionIndex(
  base: Record<string, string>,
  collections: Record<string, unknown[]>,
  index: number,
): Record<string, string> {
  const out = { ...base };
  for (const [name, arr] of Object.entries(collections)) {
    if (index < arr.length) {
      out[name] = collectionElementToSubstitutionValue(arr[index]);
    }
  }
  return out;
}

/**
 * Detect how many HTTP sends JetBrains would perform for collection variables in this request.
 * Simple {{varName}} references only (not JSONPath $.… yet).
 */
export function detectCollectionIterationPlan(
  block: KulalaBlock,
  effectiveBody: unknown,
  vars: Record<string, string>,
): CollectionIterationPlan {
  const url = typeof block.request.url === "string" ? block.request.url : "";
  const headerRecords = buildHeadersFromSection(block.request.headerSection);
  const headerText = Object.entries(headerRecords)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const refNames = new Set<string>([
    ...extractVariableRefsFromText(url),
    ...extractVariableRefsFromText(headerText),
    ...collectRefsFromBody(effectiveBody),
  ]);

  const collections: Record<string, unknown[]> = {};
  for (const name of refNames) {
    if (name.startsWith("$.")) continue;
    const arr = parseVariableCollection(vars[name]);
    if (arr) collections[name] = arr;
  }

  const lengths = Object.values(collections).map((a) => a.length);
  if (lengths.length === 0) {
    return { count: 1, collections: {} };
  }

  const count = Math.max(...lengths);
  const primaryCollection = Object.keys(collections)[0];
  return { count, collections, primaryCollection };
}

export function templateValueAtIndex(
  plan: CollectionIterationPlan,
  index: number,
): unknown {
  const name = plan.primaryCollection;
  if (!name) return undefined;
  const arr = plan.collections[name];
  if (!arr || index < 0 || index >= arr.length) return undefined;
  return arr[index];
}
