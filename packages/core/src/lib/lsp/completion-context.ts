import type { KulalaDocument } from "../parser/types";
import { parseAtVariableLine } from "../parser/at-variables";
import { isRequestLine } from "../parser/request";
import { findBlockAtCursor } from "../runner/block";
import type {
  KulalaBlockLineTypeName,
  KulalaSeenBlockLineTypes,
} from "../parser/types/block";

function classifyBlockLine(
  line: string,
  lineIdx: number,
  seenBlockTypes: KulalaSeenBlockLineTypes,
): KulalaBlockLineTypeName {
  if (lineIdx === 0 && line.startsWith("###")) return "name";
  if (line.startsWith("###")) return "name";
  if (
    seenBlockTypes.has("afterHeaders") &&
    (line.startsWith(">>!") || line.startsWith(">>"))
  ) {
    return "responseRedirect";
  }
  if (seenBlockTypes.has("afterHeaders") && line.startsWith("> ")) {
    return "postRequestScript";
  }
  if (
    seenBlockTypes.has("request") &&
    seenBlockTypes.has("afterHeaders") &&
    !seenBlockTypes.has("afterBody") &&
    !seenBlockTypes.has("postRequestScript")
  ) {
    return "body";
  }
  if (line.startsWith("< ")) return "preRequestScript";
  if (!seenBlockTypes.has("request") && line.trim().startsWith("@")) {
    if (parseAtVariableLine(line) !== undefined) return "docVariable";
  }
  if (line.startsWith("# @") || line.startsWith("// @")) return "operator";
  if (line.startsWith("#") || line.trim().startsWith("//")) return "comment";
  if (isRequestLine(line)) return "request";
  if (
    seenBlockTypes.has("request") &&
    !seenBlockTypes.has("body") &&
    /^\s/.test(line)
  ) {
    return "requestContinuation";
  }
  if (
    seenBlockTypes.has("request") &&
    !seenBlockTypes.has("afterHeaders") &&
    !seenBlockTypes.has("body") &&
    line.trim() !== ""
  ) {
    if (line.includes(":") || !/^\s/.test(line)) return "headers";
  }
  if (seenBlockTypes.has("request") && line.trim() === "") {
    return "afterHeaders";
  }
  if (line.trim() === "" && seenBlockTypes.has("body")) return "afterBody";
  return "unknown";
}

export type CursorLineContext =
  | KulalaBlockLineTypeName
  | "outside"
  | "file_header";

/** Classify the HTTP document line under the cursor (1-based file line). */
export function blockLineKindAtCursor(
  doc: KulalaDocument,
  content: string,
  line1: number,
): CursorLineContext {
  const directiveOffset = doc.directiveLinesRemoved ?? 0;
  const adjustedLine = line1 - directiveOffset;
  if (adjustedLine < 1) return "outside";

  const firstBlock = doc.blocks[0];
  if (firstBlock && adjustedLine < firstBlock.position.start) {
    return "file_header";
  }

  const block = findBlockAtCursor(doc, { line: line1, column: 1 });
  if (!block) return "outside";

  const fileLineStart = block.position.start + directiveOffset;
  const lines = content.split(/\r?\n/);
  const seen: KulalaSeenBlockLineTypes = new Set();

  for (let fileLine = fileLineStart; fileLine <= line1; fileLine++) {
    const line = lines[fileLine - 1] ?? "";
    const relIdx = fileLine - fileLineStart;
    const kind = classifyBlockLine(line, relIdx, seen);
    if (fileLine === line1) return kind;
    if (!seen.has(kind)) seen.add(kind);
  }

  return "unknown";
}

function isHeaderValueCursor(lineToCursor: string): boolean {
  const colon = lineToCursor.indexOf(":");
  if (colon < 0) return false;
  return colon < lineToCursor.length - 1 || lineToCursor.endsWith(":");
}

/** Fallback completion sources from block structure when line regexes do not match. */
export function structuralCompletionSources(
  doc: KulalaDocument,
  content: string,
  line1: number,
  lineToCursor: string,
): string[] {
  const kind = blockLineKindAtCursor(doc, content, line1);

  if (kind === "headers") {
    if (isHeaderValueCursor(lineToCursor)) {
      return ["header_values", "document_variables", "env_variables"];
    }
    return ["header_names"];
  }

  if (kind === "request" || kind === "requestContinuation") {
    if (/{{/.test(lineToCursor)) {
      return ["document_variables", "env_variables"];
    }
    if (/\//.test(lineToCursor)) {
      return ["request_urls", "schemes"];
    }
    return ["methods", "schemes", "request_urls"];
  }

  if (kind === "body") {
    if (/{{/.test(lineToCursor)) {
      return ["document_variables", "env_variables"];
    }
    if (/</.test(lineToCursor)) return ["snippets_in"];
    if (/>/.test(lineToCursor)) return ["snippets_out"];
    return [];
  }

  if (
    kind === "preRequestScript" ||
    kind === "postRequestScript" ||
    kind === "operator"
  ) {
    return ["scripts", "metadata"];
  }

  if (kind === "file_header") return ["metadata", "commands"];
  if (kind === "comment") {
    if (/# @|\/\/ @/.test(lineToCursor)) return ["metadata"];
    return [];
  }
  if (kind === "name" || kind === "docVariable") return [];
  if (kind === "outside") return ["commands", "methods"];

  return ["methods", "schemes"];
}

/** Prefix inside an unfinished `{{ ... }}` template at the cursor. */
export function templateVarPrefix(lineToCursor: string): string | null {
  const m = lineToCursor.match(/\{\{([^}]*)$/);
  return m ? (m[1] ?? "") : null;
}
