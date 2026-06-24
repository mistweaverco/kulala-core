import { doRequestFromBlock } from "./doRequest";
import { findBlockForRunRequest } from "./find-block-for-run-request";
import { getBlockResultKey } from "./block-result-key";
import { recordRequestVarResult } from "./request-var-context";
import {
  makeResponseForScripts,
  runnerResponseLikeFromSuccess,
  type ScriptResponse,
} from "./script-response";
import { ScriptPromptError } from "./script-prompt-error";
import type { ScriptFlowContext } from "./scripts";
import type {
  KulalaPromptResponse,
  KulalaRequestSuccessResponse,
  VariableResolver,
} from "./types";
import type { KulalaDocument } from "../parser/types";

export const MAX_RUN_REQUEST_DEPTH = 16;

export type RunRequestFromScriptContext = {
  doc?: KulalaDocument;
  filePath?: string;
  mutableVars: Record<string, string>;
  flow?: ScriptFlowContext;
  env: string;
  resolver?: VariableResolver;
  stableDocId: string;
  runRequestStack: string[];
};

function stackKey(filePath: string | undefined, blockName: string): string {
  return `${filePath ?? "<unknown>"}#${blockName}`;
}

function isPromptResponse(
  item: unknown,
): item is KulalaPromptResponse & { success: false } {
  return (
    typeof item === "object" &&
    item !== null &&
    "success" in item &&
    (item as { success: boolean }).success === false &&
    "prompt" in item &&
    (item as { prompt?: boolean }).prompt === true
  );
}

function isSkippedResponse(item: unknown): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    "success" in item &&
    (item as { success: boolean }).success === true &&
    "skipped" in item &&
    (item as { skipped?: boolean }).skipped === true
  );
}

function isSuccessResponse(
  item: unknown,
): item is KulalaRequestSuccessResponse {
  return (
    typeof item === "object" &&
    item !== null &&
    "success" in item &&
    (item as { success: boolean }).success === true &&
    "status" in item &&
    "body" in item
  );
}

export async function runRequestFromScript(
  ctx: RunRequestFromScriptContext,
  name: string,
  externalFilePath?: string,
): Promise<ScriptResponse> {
  if (!ctx.doc) {
    throw new Error("$kulala.runRequest: document context is required");
  }

  const {
    block,
    doc: targetDoc,
    filePath: targetFilePath,
  } = await findBlockForRunRequest(
    ctx.doc,
    name,
    ctx.filePath ?? ctx.doc.filepath,
    externalFilePath,
  );

  const key = stackKey(targetFilePath, block.name);
  if (ctx.runRequestStack.includes(key)) {
    throw new Error(
      `$kulala.runRequest: circular request chain detected at ${block.name}`,
    );
  }
  if (ctx.runRequestStack.length >= MAX_RUN_REQUEST_DEPTH) {
    throw new Error(
      `$kulala.runRequest: max nesting depth (${MAX_RUN_REQUEST_DEPTH}) exceeded`,
    );
  }

  const nextStack = [...ctx.runRequestStack, key];

  const result = await doRequestFromBlock(
    block,
    targetFilePath,
    ctx.mutableVars,
    ctx.stableDocId,
    ctx.resolver,
    ctx.env,
    ctx.flow,
    {
      doc: targetDoc,
      skipSharedHooks: true,
      skipCollectionExpansion: true,
      runRequestStack: nextStack,
    },
  );

  const item = Array.isArray(result) ? result[0]! : result;

  if (isPromptResponse(item)) {
    throw new ScriptPromptError(item);
  }

  if (isSkippedResponse(item)) {
    throw new Error(`$kulala.runRequest: request "${block.name}" was skipped`);
  }

  if (!isSuccessResponse(item)) {
    const message =
      typeof item === "object" &&
      item !== null &&
      "error" in item &&
      typeof (item as { error?: unknown }).error === "string"
        ? (item as { error: string }).error
        : `$kulala.runRequest: request "${block.name}" failed`;
    throw new Error(message);
  }

  if (ctx.flow?.requestVarResults) {
    recordRequestVarResult(
      ctx.doc,
      block,
      ctx.stableDocId,
      getBlockResultKey(block),
      {
        body:
          item.body.type === "binary"
            ? {
                type: "text",
                content: "",
                ...(item.body.mediaType
                  ? { mediaType: item.body.mediaType }
                  : {}),
              }
            : item.body,
        headers: item.headers,
      },
      ctx.flow.requestVarResults,
    );
  }

  return makeResponseForScripts(runnerResponseLikeFromSuccess(item), item.url);
}
