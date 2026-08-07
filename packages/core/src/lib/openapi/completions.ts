import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { blockLineKindAtCursor } from "../lsp/completion-context";
import {
  LspCompletionItemKind,
  type LspCompletionItem,
  type LspHover,
} from "../lsp/types";
import { loadOpenAPISchema } from "../persistence/openapi-schema-store";
import { buildOpenAPIIndex } from "./schema-index";
import { blockHasOpenAPIOperator } from "./context";
import { openAPICacheKeyFromSource } from "./host";
import { resolveOpenAPIBaseUrl } from "./base-url";
import type { OpenAPIIndex } from "./types";

export type OpenAPILspCompletionResult = {
  active: boolean;
  items: LspCompletionItem[];
};

function openapiBlocks(doc: KulalaDocument): KulalaBlock[] {
  return doc.blocks.filter((b) => blockHasOpenAPIOperator(doc, b));
}

async function loadIndexForBlock(
  doc: KulalaDocument,
  block: KulalaBlock,
  content: string,
  env: string,
): Promise<OpenAPIIndex | undefined> {
  const { resolveRequestFromBlock } =
    await import("../runner/resolve-request-from-block");
  const { getStableDocumentId, resolveVariables } =
    await import("../variables");
  const { createRequestVarContext } =
    await import("../runner/request-var-context");
  const { collectSharedGrpcFlags } = await import("../grpc");
  const pathMod = await import("path");

  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, content);
  const vars = await resolveVariables(env, stableDocId, block.name, startDir, {
    fileHeader:
      block.sourceFileHeaderVariables ?? doc.fileHeaderVariables ?? undefined,
    blockPreamble: block.preambleVariables,
  });
  const flow = {
    globalHeaders: {},
    sharedGrpcFlags: collectSharedGrpcFlags(doc.blocks),
  };
  const { resolver } = createRequestVarContext(doc, block, stableDocId);
  const resolved = await resolveRequestFromBlock(
    block,
    doc.filepath,
    vars,
    resolver,
    env,
    flow,
    doc,
  );
  if (!("ok" in resolved) || !resolved.ok || resolved.request.kind !== "http") {
    return undefined;
  }
  const cacheKey = openAPICacheKeyFromSource(resolved.request.url, startDir);
  const cached = loadOpenAPISchema(cacheKey);
  if (!cached) return undefined;
  return buildOpenAPIIndex(cached.spec, resolved.request.url);
}

function mkItem(partial: LspCompletionItem): LspCompletionItem {
  return partial;
}

function completionItemsForIndex(
  index: OpenAPIIndex,
  lineKind: ReturnType<typeof blockLineKindAtCursor>,
  vars: Record<string, string>,
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];
  const base = resolveOpenAPIBaseUrl(index, vars);

  if (
    lineKind === "request" ||
    lineKind === "requestContinuation" ||
    lineKind === "unknown"
  ) {
    for (const [key, op] of index.operations.entries()) {
      const pathOnly = op.path;
      const fullUrl = base
        ? `${base}${pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`}`
        : pathOnly;
      items.push(
        mkItem({
          label: key,
          kind: LspCompletionItemKind.Function,
          detail: op.summary ?? op.operationId,
          documentation: op.description
            ? { kind: "markdown", value: op.description }
            : undefined,
          insertText: fullUrl,
          sortText: `0${key}`,
        }),
      );
      items.push(
        mkItem({
          label: pathOnly,
          kind: LspCompletionItemKind.Value,
          detail: op.method,
          insertText: pathOnly,
          sortText: `1${pathOnly}`,
        }),
      );
    }
  }

  if (lineKind === "headers") {
    const headerNames = new Set<string>();
    for (const op of index.operations.values()) {
      for (const p of op.parameters) {
        if (p.in === "header") headerNames.add(p.name);
      }
    }
    for (const name of [...headerNames].sort()) {
      items.push(
        mkItem({
          label: name,
          kind: LspCompletionItemKind.Variable,
          detail: "OpenAPI header parameter",
          insertText: `${name}: `,
          sortText: name,
        }),
      );
    }
  }

  return items;
}

export async function openAPILspCompletionItems(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<OpenAPILspCompletionResult> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const blocks = openapiBlocks(doc);
  if (blocks.length === 0) return { active: false, items: [] };

  const lineKind = blockLineKindAtCursor(doc, input.content, input.line);
  if (
    lineKind === "outside" ||
    lineKind === "file_header" ||
    lineKind === "comment" ||
    lineKind === "operator" ||
    lineKind === "preRequestScript" ||
    lineKind === "postRequestScript"
  ) {
    return { active: false, items: [] };
  }

  const env = input.env ?? "default";
  const allItems: LspCompletionItem[] = [];

  for (const block of blocks) {
    const index = await loadIndexForBlock(doc, block, input.content, env);
    if (!index) continue;
    const pathMod = await import("path");
    const startDir = doc.filepath
      ? pathMod.dirname(doc.filepath)
      : process.cwd();
    const { getStableDocumentId, resolveVariables } =
      await import("../variables");
    const stableDocId = getStableDocumentId(doc.filepath, input.content);
    const vars = await resolveVariables(
      env,
      stableDocId,
      block.name,
      startDir,
      {
        fileHeader:
          block.sourceFileHeaderVariables ??
          doc.fileHeaderVariables ??
          undefined,
        blockPreamble: block.preambleVariables,
      },
    );
    allItems.push(...completionItemsForIndex(index, lineKind, vars));
  }

  if (allItems.length === 0) return { active: false, items: [] };

  const seen = new Set<string>();
  const unique = allItems.filter((item) => {
    const k = item.label;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { active: true, items: unique };
}

export async function openAPILspHover(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<LspHover | null> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const blocks = openapiBlocks(doc);
  if (blocks.length === 0) return null;

  const lineKind = blockLineKindAtCursor(doc, input.content, input.line);
  if (lineKind !== "request" && lineKind !== "requestContinuation") {
    return null;
  }

  const lines = input.content.split(/\r?\n/);
  const line = lines[input.line - 1] ?? "";
  const urlMatch = line.match(/\s(\S+)/);
  const fragment = urlMatch?.[1] ?? "";

  for (const block of blocks) {
    const index = await loadIndexForBlock(
      doc,
      block,
      input.content,
      input.env ?? "default",
    );
    if (!index) continue;

    for (const op of index.operations.values()) {
      if (
        fragment.includes(op.path) ||
        line.toUpperCase().includes(op.method)
      ) {
        const parts = [
          `**${op.method} ${op.path}**`,
          op.summary ? `\n${op.summary}` : "",
          op.description ? `\n\n${op.description}` : "",
        ];
        return {
          contents: {
            kind: "markdown",
            value: parts.filter(Boolean).join(""),
          },
        };
      }
    }
  }

  return null;
}
