import type { KulalaBlock } from "../parser/types/block";
import type { KulalaDocument } from "../parser/types";
import {
  clearOpenAPISchemas,
  deleteOpenAPISchema,
  loadOpenAPISchema,
  saveOpenAPISchema,
} from "../persistence/openapi-schema-store";
import { resolveRequestFromBlock } from "../runner/resolve-request-from-block";
import { createRequestVarContext } from "../runner/request-var-context";
import { collectSharedGrpcFlags } from "../grpc";
import { getStableDocumentId, resolveVariables } from "../variables";
import type { ScriptFlowContext } from "../runner/scripts";
import { doRequestFromBlock } from "../runner/doRequest";
import { curlArgvHasFlag } from "../curl/passthrough";
import { getEffectiveCurlArgv } from "../runner/effective-operators";
import { openAPIBlockFromCursor } from "./context";
import { loadOpenAPISpecFromSource } from "./load";
import { prepareOpenAPIDocument } from "./prepare-document";
import { buildOpenAPIIndex } from "./schema-index";
import { openAPICacheKeyFromSource } from "./host";
import { buildOpenAPIUITree } from "./ui-tree";
import {
  buildOperationRequest,
  buildSyntheticOperationBlock,
  overridesFromTryItOutValues,
} from "./operation";
import type { OpenAPIUiPayload } from "./types";

export { openAPICacheKeyFromSource } from "./host";
export { parseOpenAPIRawText, isOpenAPIDocument } from "./parse";
export { buildOpenAPIIndex } from "./schema-index";
export type { OpenAPIIndex } from "./types";
export { buildOpenAPIUITree } from "./ui-tree";
export { openAPIBlockFromCursor, blockHasOpenAPIOperator } from "./context";
export {
  buildOperationRequest,
  buildSyntheticOperationBlock,
  overridesFromTryItOutValues,
} from "./operation";
export {
  openAPILspCompletionItems,
  openAPILspHover,
  type OpenAPILspCompletionResult,
} from "./completions";
export { prepareOpenAPIDocument } from "./prepare-document";
export { bundleOpenAPIRefs, resolveJsonPointer } from "./resolve-refs";
export { normalizeSwagger2Document } from "./normalize-swagger2";
export type {
  OpenAPIUITreeNode,
  OpenAPIUiPayload,
  OpenAPIOperation,
} from "./types";
export {
  clearOpenAPISchemas,
  deleteOpenAPISchema,
  loadOpenAPISchema,
  saveOpenAPISchema,
  listOpenAPISchemaKeys,
} from "../persistence/openapi-schema-store";

export type ClearOpenAPISchemaCacheResult = {
  cleared: number;
  keys?: string[];
};

export function clearOpenAPISchemaCache(
  cacheKey?: string,
): ClearOpenAPISchemaCacheResult {
  if (cacheKey) {
    const removed = deleteOpenAPISchema(cacheKey);
    return { cleared: removed ? 1 : 0, keys: removed ? [cacheKey] : [] };
  }
  const cleared = clearOpenAPISchemas();
  return { cleared };
}

async function resolveOpenAPIBlockRequest(
  doc: KulalaDocument,
  block: KulalaBlock,
  content: string,
  env: string,
): Promise<
  | { ok: true; url: string; headers: Record<string, string>; method: string }
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
  if ("prompt" in resolved && resolved.prompt) {
    return { ok: false, error: "Prompt required to resolve OpenAPI request" };
  }
  if (!("ok" in resolved) || !resolved.ok) {
    return {
      ok: false,
      error: "error" in resolved ? resolved.error : "Failed to resolve request",
    };
  }
  if (resolved.request.kind !== "http") {
    return { ok: false, error: "OpenAPI request resolved to non-HTTP preview" };
  }
  return {
    ok: true,
    url: resolved.request.url,
    headers: resolved.request.headers,
    method: resolved.request.method,
  };
}

async function getOrLoadOpenAPIIndex(
  doc: KulalaDocument,
  block: KulalaBlock,
  content: string,
  env: string,
): Promise<
  | { ok: true; index: import("./types").OpenAPIIndex; cacheKey: string }
  | { ok: false; error: string }
> {
  const resolved = await resolveOpenAPIBlockRequest(doc, block, content, env);
  if (!resolved.ok) return resolved;

  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const cacheKey = openAPICacheKeyFromSource(resolved.url, startDir);

  const cached = loadOpenAPISchema(cacheKey);
  if (cached) {
    const index = buildOpenAPIIndex(cached.spec, resolved.url);
    if (index) return { ok: true, index, cacheKey };
  }

  const extraCurlArgv = getEffectiveCurlArgv(doc, block, env, startDir);
  const insecure =
    curlArgvHasFlag(extraCurlArgv, "--insecure") ||
    curlArgvHasFlag(extraCurlArgv, "-k");

  const loaded = await loadOpenAPISpecFromSource(resolved.url, startDir, {
    headers: resolved.headers,
    method: resolved.method,
    insecure,
  });
  if (!loaded.ok) return loaded;

  const docParsed = prepareOpenAPIDocument(loaded.raw);
  if (docParsed) saveOpenAPISchema(loaded.cacheKey, docParsed);

  const index = buildOpenAPIIndex(docParsed ?? {}, resolved.url);
  if (!index) {
    return { ok: false, error: "Failed to build OpenAPI index" };
  }
  return { ok: true, index, cacheKey: loaded.cacheKey };
}

export async function openAPILoadAtCursor(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
}): Promise<
  { ok: true; openapi: OpenAPIUiPayload } | { ok: false; error: string }
> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const block = openAPIBlockFromCursor(doc, input.line, input.column);
  if (!block) {
    return { ok: false, error: "No OpenAPI block at cursor" };
  }

  const indexResult = await getOrLoadOpenAPIIndex(
    doc,
    block,
    input.content,
    input.env ?? "default",
  );
  if (!indexResult.ok) return indexResult;

  const tree = buildOpenAPIUITree(indexResult.index);
  return {
    ok: true,
    openapi: {
      cacheKey: indexResult.cacheKey,
      fromCache: false,
      tree,
      title: indexResult.index.title,
      version: indexResult.index.version,
    },
  };
}

export async function runOpenAPIOperation(input: {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
  operationKey: string;
  parameterOverrides?: Record<string, string>;
  responseFormat?: import("../runner/http-response-body").KulalaResponseFormatOptions;
}): Promise<import("../runner/doRequest").DoRequestFromBlockResult> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const block = openAPIBlockFromCursor(doc, input.line, input.column);
  if (!block) {
    return { success: false, error: "No OpenAPI block at cursor" };
  }

  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, input.content);
  const env = input.env ?? "default";
  const vars = await resolveVariables(env, stableDocId, block.name, startDir, {
    fileHeader:
      block.sourceFileHeaderVariables ?? doc.fileHeaderVariables ?? undefined,
    blockPreamble: block.preambleVariables,
  });

  const indexResult = await getOrLoadOpenAPIIndex(
    doc,
    block,
    input.content,
    env,
  );
  if (!indexResult.ok) {
    return { success: false, error: indexResult.error };
  }

  const built = buildOperationRequest(
    indexResult.index,
    input.operationKey,
    vars,
    overridesFromTryItOutValues(input.parameterOverrides),
  );
  if ("error" in built) {
    return { success: false, error: built.error };
  }

  const synthetic = buildSyntheticOperationBlock(
    block,
    input.operationKey,
    built,
  );
  const flow: ScriptFlowContext = {
    globalHeaders: {},
    sharedGrpcFlags: collectSharedGrpcFlags(doc.blocks),
  };
  const { resolver } = createRequestVarContext(doc, synthetic, stableDocId);

  const result = await doRequestFromBlock(
    synthetic,
    doc.filepath,
    vars,
    stableDocId,
    resolver,
    env,
    flow,
    {
      doc,
      responseFormat: input.responseFormat,
    },
  );
  const item = Array.isArray(result) ? result[0]! : result;
  return { ...item, blockName: synthetic.name };
}
