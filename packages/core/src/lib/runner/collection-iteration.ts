import type { KulalaBlock } from "../parser/types/block";
import { buildHeadersFromSection } from "./headers";
import {
  evaluateJsonPath,
  expressionHasWildcard,
  splitVariableExpression,
} from "../variables/jsonpath";
import { parseStoredVariable } from "../variables/variable-lookup";

/** JetBrains: 0-based index of the current collection loop (0 = first request). */
export type CollectionIterationPlan = {
  count: number;
  /** Variable expression → values to iterate (e.g. id → [1,2,3] or users[*].name → names). */
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

/** True for dynamic variables ($uuid, $random.*, …) - not collection-expanded. */
function isDynamicVariableRef(name: string): boolean {
  return name.startsWith("$") && !name.startsWith("$env.");
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

/**
 * Resolve a collection for {{ expression }} iteration (JetBrains JSONPath + array roots).
 */
export function resolveCollectionForExpression(
  expression: string,
  vars: Record<string, string>,
): unknown[] | null {
  if (isDynamicVariableRef(expression)) return null;

  const direct = parseVariableCollection(vars[expression]);
  if (direct) return direct;

  const { root, path } = splitVariableExpression(expression);
  if (vars[root] === undefined) return null;

  const data = parseStoredVariable(vars[root]);
  if (data === undefined) return null;

  if (!path) {
    return parseVariableCollection(vars[root]);
  }

  if (expressionHasWildcard(path)) {
    const values = evaluateJsonPath(data, path);
    if (values.length === 0) return null;
    return values;
  }

  return null;
}

function collectionElementToSubstitutionValue(el: unknown): string {
  if (el == null) return "";
  if (typeof el === "string") return el;
  if (typeof el === "number" || typeof el === "boolean") return String(el);
  return JSON.stringify(el);
}

/**
 * Build per-iteration vars: collection expressions are replaced with the element at index.
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
 * Supports {{ id }} with a JSON array and JSONPath wildcards such as {{ users[*].name }}.
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
    if (isDynamicVariableRef(name)) continue;
    const arr = resolveCollectionForExpression(name, vars);
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
