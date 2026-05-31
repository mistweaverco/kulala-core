import type { KulalaBlock } from "../parser/types/block";
import {
  clearGraphQLSchemas,
  deleteGraphQLSchema,
  loadGraphQLSchema,
  saveGraphQLSchema,
} from "../persistence/graphql-schema-store";
import { resolveRequestFromBlock } from "../runner/resolve-request-from-block";
import { createRequestVarContext } from "../runner/request-var-context";
import { collectSharedGrpcFlags } from "../grpc";
import type { KulalaDocument } from "../parser/types";
import { getStableDocumentId, resolveVariables } from "../variables";
import type { ScriptFlowContext } from "../runner/scripts";
import { graphQLBlockCursorContext } from "./context";
import { fetchGraphQLIntrospection } from "./introspect";
import { graphqlSchemaHostFromUrl } from "./host";
import {
  parseIntrospectionSchema,
  type GraphQLSchemaIndex,
} from "./schema-index";
import { graphQLCompletionItems } from "./completions";
import { graphQLHoverFromMarkdown, graphQLHoverMarkdown } from "./hover";
import type { LspCompletionItem, LspHover } from "../lsp/types";

export { graphqlSchemaHostFromUrl } from "./host";
export {
  fetchGraphQLIntrospection,
  type GraphQLIntrospectionResult,
} from "./introspect";
export {
  parseIntrospectionSchema,
  type GraphQLSchemaIndex,
} from "./schema-index";
export {
  graphQLCompletionItems,
  analyzeGraphQLBeforeCursor,
} from "./completions";
export {
  graphQLHoverMarkdown,
  graphQLHoverFromMarkdown,
  identifierAtColumn,
} from "./hover";
export { graphQLBlockCursorContext } from "./context";
export {
  clearGraphQLSchemas,
  deleteGraphQLSchema,
  loadGraphQLSchema,
  saveGraphQLSchema,
  listGraphQLSchemaHosts,
} from "../persistence/graphql-schema-store";

export type ClearGraphQLSchemaCacheResult = {
  cleared: number;
  hosts?: string[];
};

/**
 * Remove cached GraphQL introspection for one host, or all hosts when omitted.
 */
export function clearGraphQLSchemaCache(
  host?: string,
): ClearGraphQLSchemaCacheResult {
  if (host) {
    const removed = deleteGraphQLSchema(host);
    return { cleared: removed ? 1 : 0, hosts: removed ? [host] : [] };
  }
  const cleared = clearGraphQLSchemas();
  return { cleared };
}

async function resolveGraphQLRequest(
  doc: KulalaDocument,
  block: KulalaBlock,
  content: string,
  env: string,
): Promise<
  | { ok: true; url: string; headers: Record<string, string> }
  | { ok: false; error: string }
> {
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, content);
  const vars = await resolveVariables(env, stableDocId, block.name, startDir, {
    fileHeader:
      block.sourceFileHeaderVariables ?? doc.fileHeaderVariables ?? undefined,
    blockPreamble: block.preambleVariables,
  });
  const flow: ScriptFlowContext = {
    globalHeaders: {},
    sharedGrpcFlags: collectSharedGrpcFlags(doc.blocks, startDir),
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
  if ("prompt" in resolved && resolved.prompt) {
    return { ok: false, error: "Prompt required to resolve GraphQL request" };
  }
  if (!("ok" in resolved) || !resolved.ok) {
    return {
      ok: false,
      error: "error" in resolved ? resolved.error : "Failed to resolve request",
    };
  }
  return {
    ok: true,
    url: resolved.request.url,
    headers: resolved.request.headers,
  };
}

/**
 * Load schema index from DB or fetch introspection and cache by host.
 */
export async function getOrFetchGraphQLSchemaIndex(
  host: string,
  fetch: () => Promise<
    { ok: true; schema: Record<string, unknown> } | { ok: false; error: string }
  >,
): Promise<
  | { ok: true; index: GraphQLSchemaIndex; fromCache: boolean }
  | { ok: false; error: string }
> {
  const cached = loadGraphQLSchema(host);
  if (cached) {
    const index = parseIntrospectionSchema(cached.schema);
    if (index) return { ok: true, index, fromCache: true };
  }

  const result = await fetch();
  if (!result.ok) return result;

  saveGraphQLSchema(host, result.schema);
  const index = parseIntrospectionSchema(result.schema);
  if (!index) {
    return { ok: false, error: "Introspection response missing __schema" };
  }
  return { ok: true, index, fromCache: false };
}

export async function introspectGraphQLAtCursor(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<
  { ok: true; host: string; fromCache: boolean } | { ok: false; error: string }
> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const ctx = await graphQLBlockCursorContext(doc, input);
  if (!ctx) return { ok: false, error: "No GraphQL request at cursor" };

  const resolved = await resolveGraphQLRequest(
    doc,
    ctx.block,
    input.content,
    input.env ?? "default",
  );
  if (!resolved.ok) return resolved;

  const host = graphqlSchemaHostFromUrl(resolved.url);
  if (!host) return { ok: false, error: "Invalid GraphQL URL" };

  const fetched = await getOrFetchGraphQLSchemaIndex(host, () =>
    fetchGraphQLIntrospection(resolved.url, resolved.headers),
  );
  if (!fetched.ok) return fetched;
  return { ok: true, host, fromCache: fetched.fromCache };
}

export type GraphQLLspCompletionResult = {
  /** Cursor is inside the GraphQL query body (not headers/variables). */
  active: boolean;
  items: LspCompletionItem[];
};

export async function graphQLLspCompletionItems(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<GraphQLLspCompletionResult> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const ctx = await graphQLBlockCursorContext(doc, input);
  if (!ctx) return { active: false, items: [] };

  const resolved = await resolveGraphQLRequest(
    doc,
    ctx.block,
    input.content,
    input.env ?? "default",
  );
  if (!resolved.ok) return { active: true, items: [] };

  const host = graphqlSchemaHostFromUrl(resolved.url);
  if (!host) return { active: true, items: [] };

  const schemaResult = await getOrFetchGraphQLSchemaIndex(host, () =>
    fetchGraphQLIntrospection(resolved.url, resolved.headers),
  );
  if (!schemaResult.ok) return { active: true, items: [] };

  const items = graphQLCompletionItems(
    schemaResult.index,
    ctx.query,
    ctx.queryLine,
    ctx.queryColumn,
  );
  return { active: true, items };
}

/** Schema documentation hover for cursor inside a GraphQL query body. */
export async function graphQLLspHover(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<LspHover | null> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const ctx = await graphQLBlockCursorContext(doc, input);
  if (!ctx) return null;

  const resolved = await resolveGraphQLRequest(
    doc,
    ctx.block,
    input.content,
    input.env ?? "default",
  );
  if (!resolved.ok) return null;

  const host = graphqlSchemaHostFromUrl(resolved.url);
  if (!host) return null;

  const schemaResult = await getOrFetchGraphQLSchemaIndex(host, () =>
    fetchGraphQLIntrospection(resolved.url, resolved.headers),
  );
  if (!schemaResult.ok) return null;

  const markdown = graphQLHoverMarkdown(
    schemaResult.index,
    ctx.query,
    ctx.queryLine,
    ctx.queryColumn,
  );
  if (!markdown) return null;
  return graphQLHoverFromMarkdown(markdown);
}
