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
import {
  doRequestFromBlock,
  isPreRequestScriptsOk,
  runPreRequestScriptsForBlock,
  type DoRequestFromBlockResult,
} from "../runner/doRequest";
import { isSharedBlockName } from "../shared-blocks";
import { curlArgvHasFlag } from "../curl/passthrough";
import { getEffectiveCurlArgv } from "../runner/effective-operators";
import type {
  KulalaPromptResponse,
  KulalaScriptConsoleLine,
  VariableResolver,
} from "../runner/types";
import {
  openAPIBlockFromCursor,
  blockHasOpenAPINoCacheOperator,
} from "./context";
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
import { serializeHttpBlock } from "../parser/serde";
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

function buildOpenAPIFlow(doc: KulalaDocument): ScriptFlowContext {
  return {
    globalHeaders: {},
    sharedGrpcFlags: collectSharedGrpcFlags(doc.blocks),
    sharedBlocks: doc.blocks.filter((b) => isSharedBlockName(b.name)),
    sharedHttpExecuted: new Set(),
    collectedSharedHttpResults: [],
  };
}

type PreparedOpenAPIParent =
  | {
      ok: true;
      mutableVars: Record<string, string>;
      flow: ScriptFlowContext;
      stableDocId: string;
      resolver: VariableResolver | undefined;
      scriptConsole: KulalaScriptConsoleLine[];
    }
  | ({
      ok: false;
    } & Exclude<
      Awaited<ReturnType<typeof runPreRequestScriptsForBlock>>,
      { ok: true }
    >);

function preScriptResultToOpenAPIError(
  result: Exclude<
    Awaited<ReturnType<typeof runPreRequestScriptsForBlock>>,
    { ok: true }
  >,
): { ok: false; error: string } {
  if ("prompt" in result && result.prompt) {
    return { ok: false, error: "Prompt required to resolve OpenAPI request" };
  }
  if ("skipped" in result && result.skipped) {
    return {
      ok: false,
      error:
        "message" in result && typeof result.message === "string"
          ? result.message
          : "Request skipped by script",
    };
  }
  return {
    ok: false,
    error: "error" in result ? result.error : "Pre-request script failed",
  };
}

function preScriptResultToDoRequestError(
  result: Extract<PreparedOpenAPIParent, { ok: false }>,
): DoRequestFromBlockResult {
  const rest = { ...result };
  delete (rest as { ok?: false }).ok;
  if ("prompt" in rest && rest.prompt) {
    return rest as KulalaPromptResponse;
  }
  return rest as DoRequestFromBlockResult;
}

async function prepareOpenAPIParentBlock(
  doc: KulalaDocument,
  block: KulalaBlock,
  content: string,
  env: string,
  opts?: { skipPreScripts?: boolean },
): Promise<PreparedOpenAPIParent> {
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, content);
  const mutableVars = await resolveVariables(
    env,
    stableDocId,
    block.name,
    startDir,
    {
      fileHeader:
        block.sourceFileHeaderVariables ?? doc.fileHeaderVariables ?? undefined,
      blockPreamble: block.preambleVariables,
    },
  );
  const flow = buildOpenAPIFlow(doc);
  const { resolver } = createRequestVarContext(doc, block, stableDocId);
  const scriptConsole: KulalaScriptConsoleLine[] = [];

  if (!opts?.skipPreScripts) {
    const preResult = await runPreRequestScriptsForBlock(
      block,
      doc.filepath,
      mutableVars,
      stableDocId,
      resolver,
      env,
      flow,
      scriptConsole,
      { doc },
    );
    if (!isPreRequestScriptsOk(preResult)) {
      return { ok: false, ...preResult } as Extract<
        PreparedOpenAPIParent,
        { ok: false }
      >;
    }
  }

  return {
    ok: true,
    mutableVars,
    flow,
    stableDocId,
    resolver,
    scriptConsole,
  };
}

async function resolveOpenAPIBlockRequest(
  doc: KulalaDocument,
  block: KulalaBlock,
  env: string,
  mutableVars: Record<string, string>,
  flow: ScriptFlowContext,
  stableDocId: string,
  skipPreScripts = false,
): Promise<
  | { ok: true; url: string; headers: Record<string, string>; method: string }
  | { ok: false; error: string }
> {
  const { resolver } = createRequestVarContext(doc, block, stableDocId);
  const resolved = await resolveRequestFromBlock(
    block,
    doc.filepath,
    mutableVars,
    resolver,
    env,
    flow,
    doc,
    { skipPreScripts },
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
  env: string,
  mutableVars: Record<string, string>,
  flow: ScriptFlowContext,
  stableDocId: string,
): Promise<
  | {
      ok: true;
      index: import("./types").OpenAPIIndex;
      cacheKey: string;
      fromCache: boolean;
    }
  | { ok: false; error: string }
> {
  const resolved = await resolveOpenAPIBlockRequest(
    doc,
    block,
    env,
    mutableVars,
    flow,
    stableDocId,
    true,
  );
  if (!resolved.ok) return resolved;

  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const cacheKey = openAPICacheKeyFromSource(resolved.url, startDir);
  const skipCache = blockHasOpenAPINoCacheOperator(doc, block);

  const cached = skipCache ? null : loadOpenAPISchema(cacheKey);
  if (cached) {
    const index = buildOpenAPIIndex(cached.spec, resolved.url);
    if (index) return { ok: true, index, cacheKey, fromCache: true };
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
  if (docParsed && !skipCache) saveOpenAPISchema(loaded.cacheKey, docParsed);

  const index = buildOpenAPIIndex(docParsed ?? {}, resolved.url);
  if (!index) {
    return { ok: false, error: "Failed to build OpenAPI index" };
  }
  return { ok: true, index, cacheKey: loaded.cacheKey, fromCache: false };
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

  const env = input.env ?? "default";
  const prepared = await prepareOpenAPIParentBlock(
    doc,
    block,
    input.content,
    env,
  );
  if (!prepared.ok) return preScriptResultToOpenAPIError(prepared);

  const indexResult = await getOrLoadOpenAPIIndex(
    doc,
    block,
    env,
    prepared.mutableVars,
    prepared.flow,
    prepared.stableDocId,
  );
  if (!indexResult.ok) return indexResult;

  const tree = buildOpenAPIUITree(indexResult.index);
  return {
    ok: true,
    openapi: {
      cacheKey: indexResult.cacheKey,
      fromCache: indexResult.fromCache,
      tree,
      title: indexResult.index.title,
      version: indexResult.index.version,
    },
  };
}

export type OpenAPIOperationInput = {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
  operationKey: string;
  parameterOverrides?: Record<string, string>;
};

type PreparedOpenAPIOperation =
  | {
      ok: true;
      doc: KulalaDocument;
      env: string;
      prepared: Extract<PreparedOpenAPIParent, { ok: true }>;
      synthetic: KulalaBlock;
    }
  | {
      ok: false;
      error: string;
      parentFail?: Extract<PreparedOpenAPIParent, { ok: false }>;
    };

async function prepareOpenAPIOperation(
  input: OpenAPIOperationInput,
): Promise<PreparedOpenAPIOperation> {
  const { getDocument } = await import("../parser/parser");
  const doc = await getDocument(input.content, input.filepath);
  const block = openAPIBlockFromCursor(doc, input.line, input.column);
  if (!block) {
    return { ok: false, error: "No OpenAPI block at cursor" };
  }

  const env = input.env ?? "default";
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, input.content);
  const mutableVars = await resolveVariables(
    env,
    stableDocId,
    block.name,
    startDir,
    {
      fileHeader:
        block.sourceFileHeaderVariables ?? doc.fileHeaderVariables ?? undefined,
      blockPreamble: block.preambleVariables,
    },
  );
  const flow = buildOpenAPIFlow(doc);

  const resolvedForCache = await resolveOpenAPIBlockRequest(
    doc,
    block,
    env,
    mutableVars,
    flow,
    stableDocId,
    true,
  );
  const skipCache = blockHasOpenAPINoCacheOperator(doc, block);
  const specCached =
    !skipCache &&
    resolvedForCache.ok &&
    loadOpenAPISchema(
      openAPICacheKeyFromSource(resolvedForCache.url, startDir),
    ) != null;

  const prepared = await prepareOpenAPIParentBlock(
    doc,
    block,
    input.content,
    env,
    { skipPreScripts: specCached },
  );
  if (!prepared.ok) {
    return {
      ok: false,
      error: preScriptResultToOpenAPIError(prepared).error,
      parentFail: prepared,
    };
  }

  const indexResult = await getOrLoadOpenAPIIndex(
    doc,
    block,
    env,
    prepared.mutableVars,
    prepared.flow,
    prepared.stableDocId,
  );
  if (!indexResult.ok) {
    return { ok: false, error: indexResult.error };
  }

  const built = buildOperationRequest(
    indexResult.index,
    input.operationKey,
    prepared.mutableVars,
    overridesFromTryItOutValues(input.parameterOverrides),
  );
  if ("error" in built) {
    return { ok: false, error: built.error };
  }

  const synthetic = buildSyntheticOperationBlock(
    block,
    input.operationKey,
    built,
  );
  return { ok: true, doc, env, prepared, synthetic };
}

export async function runOpenAPIOperation(
  input: OpenAPIOperationInput & {
    responseFormat?: import("../runner/http-response-body").KulalaResponseFormatOptions;
  },
): Promise<import("../runner/doRequest").DoRequestFromBlockResult> {
  const prep = await prepareOpenAPIOperation(input);
  if (!prep.ok) {
    if (prep.parentFail) {
      return preScriptResultToDoRequestError(prep.parentFail);
    }
    return { success: false, error: prep.error };
  }

  const { resolver } = createRequestVarContext(
    prep.doc,
    prep.synthetic,
    prep.prepared.stableDocId,
  );

  const result = await doRequestFromBlock(
    prep.synthetic,
    prep.doc.filepath,
    prep.prepared.mutableVars,
    prep.prepared.stableDocId,
    resolver,
    prep.env,
    prep.prepared.flow,
    {
      doc: prep.doc,
      responseFormat: input.responseFormat,
    },
  );
  const item = Array.isArray(result) ? result[0]! : result;
  return { ...item, blockName: prep.synthetic.name };
}

export type OpenAPIOperationToHttpResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

export async function openAPIOperationToHttp(
  input: OpenAPIOperationInput,
): Promise<OpenAPIOperationToHttpResult> {
  const prep = await prepareOpenAPIOperation(input);
  if (!prep.ok) {
    return { ok: false, error: prep.error };
  }

  const yankBlock: KulalaBlock = {
    ...prep.synthetic,
    scripts: { preRequest: [], postRequest: [] },
  };
  return { ok: true, content: serializeHttpBlock(yankBlock) };
}
