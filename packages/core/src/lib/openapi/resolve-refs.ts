import type { OpenAPIDocument } from "./types";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Resolve a JSON Pointer (`#/components/schemas/Pet`) within the document. */
export function resolveJsonPointer(doc: OpenAPIDocument, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref.slice(2).split("/").map(decodeURIComponent);
  let cur: unknown = doc;
  for (const part of parts) {
    const rec = asRecord(cur);
    if (!rec || !(part in rec)) return undefined;
    cur = rec[part];
  }
  return cur;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep-resolve `$ref` in a schema/object (in-place safe via clone).
 * Handles `#/components/...` and `#/definitions/...` (Swagger 2.0).
 */
export function dereferenceOpenAPIValue(
  doc: OpenAPIDocument,
  value: unknown,
  seen: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > 32) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => dereferenceOpenAPIValue(doc, v, seen, depth + 1));
  }
  const rec = asRecord(value);
  if (!rec) return value;

  if (typeof rec.$ref === "string") {
    const ref = rec.$ref;
    if (seen.has(ref)) {
      return { type: "object", description: `(circular ${ref})` };
    }
    seen.add(ref);
    const resolved = resolveJsonPointer(doc, ref);
    if (resolved === undefined) return rec;
    return dereferenceOpenAPIValue(doc, cloneJson(resolved), seen, depth + 1);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "$ref") continue;
    out[k] = dereferenceOpenAPIValue(doc, v, new Set(seen), depth + 1);
  }
  return out;
}

/** Return a copy of the OpenAPI document with `$ref` nodes expanded for indexing. */
export function bundleOpenAPIRefs(doc: OpenAPIDocument): OpenAPIDocument {
  return dereferenceOpenAPIValue(doc, cloneJson(doc)) as OpenAPIDocument;
}
