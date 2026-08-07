import { parse as parseYaml } from "yaml";
import type { OpenAPIDocument } from "./types";

export function parseOpenAPIRawText(raw: string): OpenAPIDocument | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as OpenAPIDocument;
    } catch {
      return undefined;
    }
  }
  try {
    const doc = parseYaml(trimmed);
    if (doc && typeof doc === "object") {
      return doc as OpenAPIDocument;
    }
  } catch {
    // fall through
  }
  return undefined;
}

export function isOpenAPIDocument(doc: OpenAPIDocument): boolean {
  if (typeof doc.openapi === "string" && doc.openapi.startsWith("3.")) {
    return true;
  }
  if (doc.swagger === "2.0") return true;
  return false;
}
