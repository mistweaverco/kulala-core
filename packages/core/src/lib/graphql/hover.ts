import type { LspHover } from "../lsp/types";
import {
  analyzeGraphQLBeforeCursor,
  detectGraphQLOperation,
  queryTextBeforeCursor,
  stripGraphQLCommentsAndStrings,
} from "./completions";
import {
  fieldReturnTypeName,
  getTypeDef,
  namedTypeFromRef,
  rootTypeNameForOperation,
  type GraphQLField,
  type GraphQLInputValue,
  type GraphQLSchemaIndex,
  type GraphQLTypeRef,
  type GraphQLOperationKind,
} from "./schema-index";

export function identifierAtColumn(
  line: string,
  column1: number,
): { name: string } | null {
  const col0 = Math.max(0, column1 - 1);
  const re = /\$?\w+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const start = m.index!;
    const end = start + m[0].length;
    if (col0 >= start && col0 <= end) {
      return { name: m[0]! };
    }
  }
  return null;
}

export function displayTypeRef(ref: GraphQLTypeRef | null | undefined): string {
  if (!ref) return "Unknown";
  if (ref.kind === "NON_NULL") {
    return `${displayTypeRef(ref.ofType)}!`;
  }
  if (ref.kind === "LIST") {
    return `[${displayTypeRef(ref.ofType)}]`;
  }
  return ref.name ?? ref.kind;
}

function fieldOnType(
  index: GraphQLSchemaIndex,
  typeName: string,
  fieldName: string,
): GraphQLField | undefined {
  return getTypeDef(index, typeName)?.fields?.find((f) => f.name === fieldName);
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

function formatArgLine(arg: GraphQLInputValue): string {
  const typeName = displayTypeRef(arg.type);
  const defaultVal =
    arg.defaultValue != null && arg.defaultValue !== ""
      ? ` — default: \`${arg.defaultValue}\``
      : "";
  const desc = arg.description?.trim() ? `\n  ${arg.description.trim()}` : "";
  return `- \`${arg.name}\` (**${typeName}**)${defaultVal}${desc}`;
}

function formatFieldHover(
  index: GraphQLSchemaIndex,
  field: GraphQLField,
  parentType: string,
): string {
  const lines: string[] = [];
  lines.push(`**${field.name}** on \`${parentType}\``);
  lines.push("");
  lines.push(`Type: \`${displayTypeRef(field.type)}\``);
  if (field.description?.trim()) {
    lines.push("");
    lines.push(field.description.trim());
  }
  if (field.args?.length) {
    lines.push("");
    lines.push("### Arguments");
    for (const arg of field.args) {
      lines.push(formatArgLine(arg));
    }
  }
  const returnName = namedTypeFromRef(field.type);
  const returnDef = returnName ? getTypeDef(index, returnName) : undefined;
  if (returnDef?.description?.trim()) {
    lines.push("");
    lines.push(`### Type \`${returnName}\``);
    lines.push("");
    lines.push(returnDef.description.trim());
  }
  return lines.join("\n");
}

function formatArgumentHover(
  arg: GraphQLInputValue,
  fieldName: string,
  parentType: string,
): string {
  const lines: string[] = [];
  lines.push(`**${arg.name}** (argument)`);
  lines.push("");
  lines.push(`Field: \`${fieldName}\` on \`${parentType}\``);
  lines.push("");
  lines.push(`Type: \`${displayTypeRef(arg.type)}\``);
  if (arg.defaultValue != null && arg.defaultValue !== "") {
    lines.push("");
    lines.push(`Default: \`${arg.defaultValue}\``);
  }
  if (arg.description?.trim()) {
    lines.push("");
    lines.push(arg.description.trim());
  }
  return lines.join("\n");
}

function formatRootOperationHover(
  index: GraphQLSchemaIndex,
  op: GraphQLOperationKind,
): string {
  const rootName = rootTypeNameForOperation(index, op);
  const def = getTypeDef(index, rootName);
  const lines: string[] = [];
  lines.push(`**${op}** root type: \`${rootName}\``);
  if (def?.description?.trim()) {
    lines.push("");
    lines.push(def.description.trim());
  }
  const fields = def?.fields?.filter((f) => !f.name.startsWith("__")) ?? [];
  if (fields.length > 0) {
    lines.push("");
    lines.push("### Entry fields");
    const preview = fields.slice(0, 12);
    for (const f of preview) {
      lines.push(`- \`${f.name}\` (\`${displayTypeRef(f.type)}\`)`);
    }
    if (fields.length > preview.length) {
      lines.push(`- … and ${fields.length - preview.length} more`);
    }
  }
  return lines.join("\n");
}

function formatVariableHover(varName: string, typeName: string): string {
  return [`**$${varName}** (variable)`, "", `Type: \`${typeName}\``].join("\n");
}

function variableTypeFromQuery(
  query: string,
  varName: string,
): string | undefined {
  const clean = stripGraphQLCommentsAndStrings(query);
  const re = new RegExp(`\\$${varName}\\s*:\\s*([\\w\\[\\]!]+)`, "i");
  const m = clean.match(re);
  return m?.[1];
}

function formatTypeHover(index: GraphQLSchemaIndex, typeName: string): string {
  const def = getTypeDef(index, typeName);
  if (!def) return `**${typeName}**`;
  const lines: string[] = [];
  lines.push(`**${typeName}** (${def.kind})`);
  if (def.description?.trim()) {
    lines.push("");
    lines.push(def.description.trim());
  }
  if (def.enumValues?.length) {
    lines.push("");
    lines.push("### Values");
    for (const v of def.enumValues.slice(0, 20)) {
      lines.push(`- \`${v.name}\``);
    }
  }
  return lines.join("\n");
}

export function graphQLHoverMarkdown(
  index: GraphQLSchemaIndex,
  query: string,
  line1: number,
  column1: number,
): string | null {
  const lines = query.split(/\r?\n/);
  const line = lines[Math.max(0, line1 - 1)] ?? "";
  const ident = identifierAtColumn(line, column1);
  if (!ident) return null;

  const name = ident.name;
  const before = queryTextBeforeCursor(query, line1, column1);
  const analysis = analyzeGraphQLBeforeCursor(before);
  if (!analysis) return null;

  if (name.startsWith("$")) {
    const varName = name.slice(1);
    const typeName = variableTypeFromQuery(query, varName);
    if (typeName) return formatVariableHover(varName, typeName);
    return formatVariableHover(varName, "unknown");
  }

  const opKeywords = ["query", "mutation", "subscription"] as const;
  if (
    opKeywords.includes(name as (typeof opKeywords)[number]) &&
    detectGraphQLOperation(query) === name
  ) {
    return formatRootOperationHover(index, name as GraphQLOperationKind);
  }

  if (analysis.mode === "argument" && analysis.argumentField) {
    const parent = resolveParentType(
      index,
      analysis.operation,
      analysis.fieldSegments,
    );
    const field = fieldOnType(index, parent, analysis.argumentField);
    const arg = field?.args?.find((a) => a.name === name);
    if (arg) return formatArgumentHover(arg, analysis.argumentField, parent);
  }

  const parent = resolveParentType(
    index,
    analysis.operation,
    analysis.fieldSegments,
  );
  const field = fieldOnType(index, parent, name);
  if (field) return formatFieldHover(index, field, parent);

  if (analysis.fieldSegments.length > 0) {
    const last = analysis.fieldSegments[analysis.fieldSegments.length - 1]!;
    if (last === name) {
      const outerParent = resolveParentType(
        index,
        analysis.operation,
        analysis.fieldSegments.slice(0, -1),
      );
      const outerField = fieldOnType(index, outerParent, name);
      if (outerField) return formatFieldHover(index, outerField, outerParent);
    }
  }

  const typeDef = getTypeDef(index, name);
  if (typeDef && !name.startsWith("__")) {
    return formatTypeHover(index, name);
  }

  return null;
}

export function graphQLHoverFromMarkdown(markdown: string): LspHover {
  return {
    contents: {
      kind: "markdown",
      value: markdown,
    },
  };
}
