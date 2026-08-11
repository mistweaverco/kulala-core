import { curlArgvHasFlag } from "../curl/passthrough";
import type { KulalaBlock } from "../parser/types/block";
import { saveOpenAPISchema } from "../persistence/openapi-schema-store";
import { blockHasOpenAPINoCacheOperator } from "./context";
import {
  runScripts,
  type ScriptFlowContext,
  type ScriptRunScope,
} from "../runner/scripts";
import {
  buildScriptRequestContextFromBlock,
  bodyPayloadToScriptString,
} from "../runner/script-request-context";
import {
  MAX_SCRIPT_REPLAYS,
  ScriptReplayError,
} from "../runner/script-control-error";
import { ScriptPromptError } from "../runner/script-prompt-error";
import { loadOpenAPISpecFromSource } from "./load";
import { prepareOpenAPIDocument } from "./prepare-document";
import { buildOpenAPIIndex } from "./schema-index";
import { buildOpenAPIUITree } from "./ui-tree";
import type { OpenAPIUiPayload } from "./types";
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaScriptConsoleLine,
  RunnerResponseLike,
  VariableResolver,
} from "../runner/types";
import type { DoRequestFromBlockOptions } from "../runner/doRequest";
import type { CollectionIterationPlan } from "../runner/collection-iteration";

export type OpenAPIBlockRunContext = {
  block: KulalaBlock;
  filePath: string | undefined;
  url: string;
  headers: Record<string, string>;
  method: string;
  mutableVars: Record<string, string>;
  stableDocId: string;
  resolver: VariableResolver | undefined;
  env: string;
  flow?: ScriptFlowContext;
  scriptRunScope: ScriptRunScope;
  effectiveBody: KulalaBlock["request"]["body"];
  scriptConsole: KulalaScriptConsoleLine[];
  collectionIndex: number;
  collectionPlan?: CollectionIterationPlan;
  iterationOptions?: DoRequestFromBlockOptions;
  extraCurlArgv: string[];
  startDir: string;
  runSharedPostScripts: () => Promise<void>;
};

export async function runOpenAPIFromBlock(
  ctx: OpenAPIBlockRunContext,
): Promise<
  | KulalaRequestSuccessResponse
  | KulalaRequestErrorResponse
  | import("../runner/types").KulalaPromptResponse
> {
  const {
    block,
    filePath,
    url,
    headers,
    method,
    mutableVars,
    resolver,
    env,
    flow,
    scriptRunScope,
    effectiveBody,
    scriptConsole,
    collectionIndex,
    collectionPlan,
    iterationOptions,
    extraCurlArgv,
    startDir,
    runSharedPostScripts,
  } = ctx;

  const insecure =
    curlArgvHasFlag(extraCurlArgv, "--insecure") ||
    curlArgvHasFlag(extraCurlArgv, "-k");

  let scriptReplayIndex = iterationOptions?.scriptReplayIndex ?? 0;

  scriptReplay: while (true) {
    if (scriptReplayIndex > MAX_SCRIPT_REPLAYS) {
      return {
        success: false,
        error: `Too many $kulala.request.replay() calls (max ${MAX_SCRIPT_REPLAYS})`,
        ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
      };
    }

    const skipCache = blockHasOpenAPINoCacheOperator(
      iterationOptions?.doc,
      block,
    );

    const loaded = await loadOpenAPISpecFromSource(url, startDir, {
      headers,
      method,
      insecure,
    });
    if (!loaded.ok) {
      return {
        success: false,
        error: loaded.error,
        blockName: block.name,
        ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
      };
    }

    const doc = prepareOpenAPIDocument(loaded.raw);
    if (doc && !skipCache) saveOpenAPISchema(loaded.cacheKey, doc);

    const rawBody = loaded.raw;
    const responseHeaders = { "content-type": "application/json" };
    const statusCode = 200;

    const responseLike: RunnerResponseLike = {
      body: rawBody,
      statusCode,
      headers: responseHeaders,
      timings: { phases: { total: 0 } },
    };

    const postScriptRequestCtx = buildScriptRequestContextFromBlock({
      block,
      phase: "postRequest",
      effectiveBody,
      env,
      startDir,
      mutableVars,
      resolver,
      iteration: collectionIndex,
      collectionPlan,
      urlSent: url,
      headersSent: headers,
      bodySent: bodyPayloadToScriptString(undefined),
      responseUrl: url,
      responseHeaders,
    });

    try {
      await runScripts(
        block.scripts.postRequest,
        "postRequest",
        block,
        filePath,
        responseLike,
        mutableVars,
        flow,
        scriptConsole,
        postScriptRequestCtx,
        scriptRunScope,
      );

      if (!iterationOptions?.skipSharedHooks) {
        await runSharedPostScripts();
      }
    } catch (error) {
      if (error instanceof ScriptPromptError) {
        return error.promptResponse;
      }
      if (error instanceof ScriptReplayError) {
        scriptReplayIndex += 1;
        continue scriptReplay;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        blockName: block.name,
        ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
      };
    }

    const parsedDoc = prepareOpenAPIDocument(rawBody);
    if (!parsedDoc) {
      return {
        success: false,
        error: "OpenAPI spec is not valid JSON or YAML",
        blockName: block.name,
        ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
      };
    }
    const index = buildOpenAPIIndex(parsedDoc, url);
    if (!index) {
      return {
        success: false,
        error: "Document is not a recognized OpenAPI spec",
        blockName: block.name,
        ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
      };
    }

    const tree = buildOpenAPIUITree(index);
    const openapi: OpenAPIUiPayload = {
      cacheKey: loaded.cacheKey,
      fromCache: false,
      tree,
      title: index.title,
      version: index.version,
    };

    return {
      success: true,
      openapiUi: true,
      openapi,
      blockName: block.name,
      status: statusCode,
      headers: responseHeaders,
      url,
      timings: {
        dns: 0,
        tcp: 0,
        tls: 0,
        request: 0,
        redirect: 0,
        firstByte: 0,
        startTransfer: 0,
        total: 0,
      },
      body: {
        type: "text",
        content: "",
        mediaType: "application/json",
      },
      ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
    };
  }

  return {
    success: false,
    error: "OpenAPI block run failed",
    blockName: block.name,
  };
}
