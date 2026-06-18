import { getDocument } from "../parser/parser";
import { findBlocksAtCursor } from "../runner/block";
import { inspectRequestAtCursor } from "../runner/request-cursor";
import type { KulalaDocument } from "../parser/types";
import { getStableDocumentId, resolveVariables } from "../variables";
import {
  completionPrefixAtCursor,
  completionTextEdit,
  resolveScriptApiLabel,
  scriptApiHoverForLabel,
  scriptSymbolAtCursor,
} from "./script-api-docs";
import { graphQLLspCompletionItems, graphQLLspHover } from "../graphql";
import { lspVariableHover } from "./variable-hover";
import { staticCompletionItems } from "./sources";
import {
  type LspCompletionItem,
  LspCompletionItemKind,
  type LspCompletionList,
  type LspDiagnostic,
  type LspDocumentSymbol,
  type LspHover,
  type LspRange,
  LspSupportedExternalScriptFiletypes,
  type LspSupportedFiletypeAll,
  LspSymbolKind,
} from "./types";

export * from "./types";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toZeroBasedPos(
  line1: number,
  col1: number,
): { line: number; ch: number } {
  return { line: Math.max(0, line1 - 1), ch: Math.max(0, col1 - 1) };
}

function lineAt(content: string, line1: number): string {
  const lines = content.split(/\r?\n/);
  return lines[Math.max(0, line1 - 1)] ?? "";
}

function sliceToCursor(line: string, col1: number): string {
  const idx = clamp(col1 - 1, 0, line.length);
  return line.slice(0, idx);
}

function uniqueByLabel(items: LspCompletionItem[]): LspCompletionItem[] {
  const seen = new Set<string>();
  const out: LspCompletionItem[] = [];
  for (const it of items) {
    const key = it.label;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function completionContextForScriptVarKey(
  lineToCursor: string,
):
  | { kind: "client.global.get"; prefix: string }
  | { kind: "client.global.set"; prefix: string }
  | { kind: "request.variables.get"; prefix: string }
  | { kind: "request.variables.set"; prefix: string }
  | null {
  // Detect being inside the first argument (string) of global.get/global.set.
  // We keep this intentionally simple: LSP input is a single line at cursor.
  const mClient = lineToCursor.match(
    /\bclient\.(?:global|gobal)\.(get|set)\(\s*["']([^"']*)$/,
  );
  if (mClient) {
    const fn = mClient[1];
    const prefix = mClient[2] ?? "";
    if (fn === "get") return { kind: "client.global.get", prefix };
    if (fn === "set") return { kind: "client.global.set", prefix };
  }

  const mReq = lineToCursor.match(
    /\brequest\.variables\.(get|set)\(\s*["']([^"']*)$/,
  );
  if (mReq) {
    const fn = mReq[1];
    const prefix = mReq[2] ?? "";
    if (fn === "get") return { kind: "request.variables.get", prefix };
    if (fn === "set") return { kind: "request.variables.set", prefix };
  }

  return null;
}

function mkItem(opts: {
  label: string;
  description?: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}): LspCompletionItem {
  return {
    label: opts.label,
    labelDetails: opts.description
      ? { description: opts.description }
      : undefined,
    kind: opts.kind,
    detail: opts.detail,
    documentation: opts.documentation
      ? { kind: "markdown", value: opts.documentation }
      : undefined,
    insertText: opts.insertText,
    insertTextFormat: opts.insertTextFormat,
    sortText: opts.sortText,
  };
}

function isInsideScriptRegion(content: string, line1: number): boolean {
  const lines = content.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lines.length - 1, line1 - 1));

  // If we saw an opening "{%" after the last closing "%}" within the same request block,
  // consider ourselves inside a script region.
  let sawOpen = false;
  for (let i = idx; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith("###")) break;
    if (line.includes("%}")) return false;
    if (line.includes("{%")) {
      sawOpen = true;
      break;
    }
  }
  return sawOpen;
}

function completionSourceTypes(opts: {
  content: string;
  lineToCursor: string;
  line1: number;
  filetype?: LspSupportedFiletypeAll;
}): string[] {
  // Mirrors kulala.nvim `source_type` matching order, simplified.
  const matches: Array<[RegExp, string | string[]]> = [
    [/@grpc-/, "grpc"],
    [/^run #/, "request_names"],
    [/\$auth\.\w+oken\("[^"]+$/, "auth_configs"], // kept for parity; core doesn't read oauth configs here
    [/{{\$/, "dynamic_variables"], // magic vars are already in resolveVariables output
    [/{{/, ["document_variables", "env_variables", "request_names"]],
    [/{%/, "scripts"],
    [/# @|\/\/ @/, "metadata"],
    [/\//, "request_urls"],
    [/Host:/, "request_urls"],
    [/:\s*[^/]*$/, "header_values"],
    [/\b[A-Z]+\s+/, ["schemes", "request_urls"]],
    [/</, "snippets_in"],
    [/>/, "snippets_out"],
  ];

  if (opts.filetype && opts.filetype in LspSupportedExternalScriptFiletypes) {
    return ["scripts"];
  }

  // Critical: scripts are multi-line; once inside `{% ... %}` we still want script API completions.
  if (isInsideScriptRegion(opts.content, opts.line1)) return ["scripts"];

  for (const [re, src] of matches) {
    if (re.test(opts.lineToCursor)) return Array.isArray(src) ? src : [src];
  }
  return [
    "commands",
    "methods",
    "schemes",
    "request_urls",
    "header_names",
    "snippets_in",
    "snippets_out",
  ];
}

function headerNameItems(): LspCompletionItem[] {
  // Intentionally small. kulala.nvim ships a huge list; we can grow later.
  const names = [
    "Accept",
    "Authorization",
    "Content-Type",
    "Cookie",
    "Host",
    "User-Agent",
  ];
  return names.map((n) =>
    mkItem({
      label: n,
      description: "Header name",
      kind: LspCompletionItemKind.Value,
      insertText: `${n}: `,
      sortText: "1.02",
    }),
  );
}

function requestNameItems(doc: KulalaDocument): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  for (const block of doc.blocks) {
    if (!block.name) continue;
    items.push(
      mkItem({
        label: String(block.name).slice(0, 30),
        description: doc.filepath ? doc.filepath.split("/").pop() : "",
        kind: LspCompletionItemKind.Value,
        detail: block.name,
        documentation:
          typeof block.request?.body === "string"
            ? block.request.body
            : undefined,
        insertText: block.name,
        sortText: "1.02",
      }),
    );
  }
  return items;
}

function requestUrlItems(doc: KulalaDocument): LspCompletionItem[] {
  const uniq = new Set<string>();
  const items: LspCompletionItem[] = [];
  for (const block of doc.blocks) {
    const raw = block.request?.url;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const url = raw.replace(/^https?:\/\//, "");
    if (uniq.has(url)) continue;
    uniq.add(url);
    items.push(
      mkItem({
        label: url.slice(0, 30),
        description: "",
        kind: LspCompletionItemKind.Value,
        detail: url,
        insertText: url,
        sortText: "1.02",
      }),
    );
  }
  return items;
}

export async function lspCompletion(input: {
  content: string;
  filepath?: string;
  env?: string;
  line: number;
  column: number;
  filetype?: LspSupportedFiletypeAll;
}): Promise<LspCompletionList> {
  const doc = await getDocument(input.content, input.filepath);

  const line = lineAt(input.content, input.line);
  const before = sliceToCursor(line, input.column);
  const sources = completionSourceTypes({
    content: input.content,
    lineToCursor: before,
    line1: input.line,
    filetype: input.filetype,
  });

  const out: LspCompletionItem[] = [];
  const stableDocId = getStableDocumentId(doc.filepath, input.content);
  const blocks = findBlocksAtCursor(doc, {
    line: input.line,
    column: input.column,
  });
  const activeBlockName = blocks[0]?.name ?? "";
  const env = input.env ?? "default";
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();

  const vars = await resolveVariables(
    env,
    stableDocId,
    activeBlockName,
    startDir,
    {
      fileHeader:
        blocks[0]?.sourceFileHeaderVariables ??
        doc.fileHeaderVariables ??
        undefined,
      blockPreamble: blocks[0]?.preambleVariables,
    },
  );

  // Context-aware completions inside scripts, beyond the static API list.
  // This mirrors the runtime behavior: `client.global.get()` can read persisted globals
  // AND the current substitution map, so we suggest from resolved variables.
  if (sources.includes("scripts")) {
    const ctx = completionContextForScriptVarKey(before);
    if (ctx) {
      const keys = Object.keys(vars).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        // Exclude "private" variables that start with "_"
        if (k.startsWith("_")) continue;
        if (
          ctx.prefix &&
          !k.toLowerCase().startsWith(ctx.prefix.toLowerCase())
        ) {
          continue;
        }
        out.push(
          mkItem({
            label: k,
            description: "Var",
            kind: LspCompletionItemKind.Variable,
            detail: k,
            documentation: vars[k],
            insertText: k,
            sortText: "0.50",
          }),
        );
      }
    }
  }

  for (const src of sources) {
    if (
      src === "methods" ||
      src === "schemes" ||
      src === "commands" ||
      src === "metadata" ||
      src === "curl" ||
      src === "grpc" ||
      src === "header_values" ||
      src === "snippets_in" ||
      src === "snippets_out" ||
      src === "scripts"
    ) {
      out.push(...staticCompletionItems(src));
      continue;
    }

    if (src === "header_names") {
      out.push(...headerNameItems());
      continue;
    }

    if (src === "request_names") {
      out.push(...requestNameItems(doc));
      continue;
    }

    if (src === "request_urls") {
      out.push(...requestUrlItems(doc));
      continue;
    }

    if (
      src === "document_variables" ||
      src === "env_variables" ||
      src === "dynamic_variables"
    ) {
      for (const [k, v] of Object.entries(vars)) {
        out.push(
          mkItem({
            label: k,
            description: "Var",
            kind: LspCompletionItemKind.Variable,
            detail: k,
            documentation: v,
            insertText: k,
            sortText: "1.02",
          }),
        );
      }
      continue;
    }
  }

  const gql = await graphQLLspCompletionItems({
    content: input.content,
    filepath: input.filepath,
    line: input.line,
    column: input.column,
    env: input.env,
  });

  const { startCol0, endCol0 } = completionPrefixAtCursor(line, input.column);
  const applyEdits = (items: LspCompletionItem[]) =>
    uniqueByLabel(items).map((item) => {
      const newText = item.insertText ?? item.label;
      return {
        ...item,
        textEdit: completionTextEdit(input.line, startCol0, endCol0, newText),
      };
    });

  // Inside a GraphQL query body: only schema field/arg suggestions (no HTTP noise).
  if (gql.active) {
    return { isIncomplete: false, items: applyEdits(gql.items) };
  }

  return { isIncomplete: false, items: applyEdits(out) };
}

export async function lspHover(input: {
  content: string;
  filepath?: string;
  env?: string;
  line: number;
  column: number;
  filetype?: LspSupportedFiletypeAll;
}): Promise<LspHover> {
  const line = lineAt(input.content, input.line);
  const symbol = scriptSymbolAtCursor(line, input.column);
  const inScript =
    (input.filetype && input.filetype in LspSupportedExternalScriptFiletypes) ||
    isInsideScriptRegion(input.content, input.line);

  if (inScript && symbol) {
    const label = resolveScriptApiLabel(symbol);
    if (label) {
      const hover = scriptApiHoverForLabel(label);
      if (hover) return hover;
    }
  }

  const gqlHover = await graphQLLspHover({
    content: input.content,
    filepath: input.filepath,
    line: input.line,
    column: input.column,
    env: input.env,
  });
  if (gqlHover) return gqlHover;

  const variableHover = await lspVariableHover({
    content: input.content,
    filepath: input.filepath,
    line: input.line,
    column: input.column,
    env: input.env,
  });
  if (variableHover) return variableHover;

  const res = await inspectRequestAtCursor({
    content: input.content,
    filepath: input.filepath,
    line: input.line,
    column: input.column,
    env: input.env ?? "default",
  });
  if ("prompt" in res && res.prompt) {
    return {
      contents: {
        kind: "plaintext",
        value: "Prompt required to inspect request.",
      },
    };
  }
  if (!("ok" in res) || !res.ok) {
    return {
      contents: {
        kind: "plaintext",
        value: "error" in res ? res.error : "No request at cursor.",
      },
    };
  }
  return {
    contents: {
      language: "http",
      value: res.lines.join("\n"),
    },
  };
}

function rangeForBlock(
  block: NonNullable<KulalaDocument["blocks"][number]>,
): LspRange {
  const startLine1 = block.position?.start ?? 1;
  const endLine1 = block.position?.end ?? startLine1;
  // LSP ranges are 0-based; end is exclusive, but we don't have exact columns.
  return {
    start: { line: Math.max(0, startLine1 - 1), character: 0 },
    end: { line: Math.max(0, endLine1), character: 0 },
  };
}

export async function lspDocumentSymbols(input: {
  content: string;
  filepath?: string;
}): Promise<LspDocumentSymbol[]> {
  const doc = await getDocument(input.content, input.filepath);
  const out: LspDocumentSymbol[] = [];
  for (const block of doc.blocks) {
    const r = rangeForBlock(block);
    out.push({
      name: block.name,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
      children: [],
    });
  }
  return out;
}

export async function lspDiagnostics(input: {
  content: string;
  filepath?: string;
}): Promise<LspDiagnostic[]> {
  const doc = await getDocument(input.content, input.filepath);
  const out: LspDiagnostic[] = [];
  for (const err of doc.hasErrors ? (doc.errors ?? []) : []) {
    const line1 = typeof err.lineNumber === "number" ? err.lineNumber : 1;
    const pos = toZeroBasedPos(line1, 1);
    out.push({
      range: {
        start: { line: pos.line, character: 0 },
        end: { line: pos.line, character: 1 },
      },
      severity: 1,
      source: "kulala",
      message: String(err.errorMessage ?? "Parse error"),
    });
  }
  return out;
}
