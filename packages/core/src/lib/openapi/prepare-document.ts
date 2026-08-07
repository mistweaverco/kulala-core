import { bundleOpenAPIRefs } from "./resolve-refs";
import { normalizeSwagger2Document } from "./normalize-swagger2";
import { parseOpenAPIRawText } from "./parse";
import type { OpenAPIDocument } from "./types";

/** Parse raw text and produce a normalized, dereferenced document for indexing. */
export function prepareOpenAPIDocument(
  raw: string,
): OpenAPIDocument | undefined {
  const doc = parseOpenAPIRawText(raw);
  if (!doc) return undefined;
  const normalized = normalizeSwagger2Document(doc);
  return bundleOpenAPIRefs(normalized);
}
