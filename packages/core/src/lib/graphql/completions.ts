import type { LspCompletionItem } from "../lsp/types";
import { LspCompletionItemKind } from "../lsp/types";
import {
  fieldReturnTypeName,
  namedTypeFromRef,
  outputFieldsForType,
  rootTypeNameForOperation,
  type GraphQLField,
  type GraphQLSchemaIndex,
  type GraphQLOperationKind,
} from "./schema-index";

export function stripGraphQLCommentsAndStrings(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function detectGraphQLOperation(query: string): GraphQLOperationKind {
  const m = query.match(/\b(query|mutation|subscription)\b/i);
  if (!m) return "query";
  return m[1]!.toLowerCase() as GraphQLOperationKind;
}

function operationBodyStart(clean: string): number {
  const m = clean.match(/\b(query|mutation|subscription)\b/i);
  if (!m || m.index === undefined) return 0;
  const brace = clean.indexOf("{", m.index);
  return brace >= 0 ? brace + 1 : clean.length;
}

export type GraphQLCursorAnalysis = {
  operation: GraphQLOperationKind;
  fieldSegments: string[];
  prefix: string;
  mode: "field" | "argument";
  argumentField?: string;
};

function currentLineFromBefore(before: string): string {
  const lines = before.split(/\r?\n/);
  return lines[lines.length - 1] ?? "";
}

/** Word characters being typed at end of the current line only (not earlier lines). */
function fieldPrefixOnCurrentLine(before: string): string {
  const m = currentLineFromBefore(before).match(/(\w*)$/);
  return m ? m[1]! : "";
}

export function analyzeGraphQLBeforeCursor(
  before: string,
): GraphQLCursorAnalysis | undefined {
  const clean = stripGraphQLCommentsAndStrings(before);
  const operation = detectGraphQLOperation(clean);
  const bodyStart = operationBodyStart(clean);
  const inBody = clean.slice(bodyStart);

  const argMatch = inBody.match(/(\w+)\s*\(\s*([^)]*)$/);
  if (argMatch) {
    const argumentField = argMatch[1]!;
    const line = currentLineFromBefore(before);
    const openParen = line.lastIndexOf("(");
    const prefix =
      openParen >= 0
        ? (line.slice(openParen + 1).match(/(\w*)$/)?.[1] ?? "")
        : (argMatch[2] ?? "").trim();
    const beforeArg = inBody.slice(0, inBody.length - argMatch[0].length);
    const fieldSegments = parseFieldSegments(beforeArg);
    return {
      operation,
      fieldSegments,
      prefix,
      mode: "argument",
      argumentField,
    };
  }

  const braceIdx = inBody.lastIndexOf("{");
  const scan = braceIdx >= 0 ? inBody.slice(0, braceIdx + 1) : "";
  const fieldSegments = parseFieldSegments(scan);
  const prefix = fieldPrefixOnCurrentLine(before);

  return {
    operation,
    fieldSegments,
    prefix,
    mode: "field",
  };
}

function parseFieldSegments(text: string): string[] {
  const segments: string[] = [];
  const re = /(\w+)\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    segments.push(m[1]!);
  }
  return segments;
}

export function queryTextBeforeCursor(
  query: string,
  line1: number,
  column1: number,
): string {
  const lines = query.split(/\r?\n/);
  const lineIdx = Math.max(0, line1 - 1);
  const col0 = Math.max(0, column1 - 1);
  const beforeLines = lines.slice(0, lineIdx);
  const currentLine = lines[lineIdx] ?? "";
  return [...beforeLines, currentLine.slice(0, col0)].join("\n");
}

function resolveParentType(
  index: GraphQLSchemaIndex,
  op: GraphQLOperationKind,
  segments: string[],
): string {
  let parent = rootTypeNameForOperation(index, op);
  for (const seg of segments) {
    const next = fieldReturnTypeName(index, parent, seg);
    if (!next) break;
    parent = next;
  }
  return parent;
}

function fieldItems(
  fields: GraphQLField[],
  prefix: string,
): LspCompletionItem[] {
  const lower = prefix.toLowerCase();
  const out: LspCompletionItem[] = [];
  for (const f of fields) {
    if (prefix && !f.name.toLowerCase().startsWith(lower)) continue;
    const typeName = namedTypeFromRef(f.type);
    out.push({
      label: f.name,
      kind: LspCompletionItemKind.Field,
      detail: typeName,
      documentation: f.description
        ? { kind: "markdown", value: f.description }
        : undefined,
      insertText: f.name,
      sortText: `0.05_${f.name}`,
    });
  }
  return out;
}

function argItems(
  index: GraphQLSchemaIndex,
  parentType: string,
  fieldName: string,
  prefix: string,
): LspCompletionItem[] {
  const parent = index.types.get(parentType);
  const field = parent?.fields?.find((f) => f.name === fieldName);
  if (!field?.args?.length) return [];
  const lower = prefix.toLowerCase();
  const out: LspCompletionItem[] = [];
  for (const arg of field.args) {
    if (prefix && !arg.name.toLowerCase().startsWith(lower)) continue;
    const typeName = namedTypeFromRef(arg.type);
    out.push({
      label: arg.name,
      kind: LspCompletionItemKind.Property,
      detail: typeName ?? undefined,
      documentation: arg.description
        ? { kind: "markdown", value: arg.description }
        : undefined,
      insertText: `${arg.name}: `,
      sortText: `0.06_${arg.name}`,
    });
  }
  return out;
}

export function graphQLCompletionItems(
  index: GraphQLSchemaIndex,
  query: string,
  line1: number,
  column1: number,
): LspCompletionItem[] {
  const before = queryTextBeforeCursor(query, line1, column1);
  const analysis = analyzeGraphQLBeforeCursor(before);
  if (!analysis) return [];

  if (analysis.mode === "argument" && analysis.argumentField) {
    const parent = resolveParentType(
      index,
      analysis.operation,
      analysis.fieldSegments,
    );
    return argItems(index, parent, analysis.argumentField, analysis.prefix);
  }

  const parentType = resolveParentType(
    index,
    analysis.operation,
    analysis.fieldSegments,
  );
  return fieldItems(outputFieldsForType(index, parentType), analysis.prefix);
}
