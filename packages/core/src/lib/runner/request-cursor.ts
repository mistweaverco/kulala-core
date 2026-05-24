import { getDocument } from "../parser/parser";
import { getStableDocumentId, resolveVariables } from "../variables";
import { findBlocksAtCursor } from "./block";
import { collectSharedGrpcFlags } from "../grpc";
import { createRequestVarContext } from "./request-var-context";
import {
  resolveRequestFromBlock,
  resolvedRequestToInspectLines,
} from "./resolve-request-from-block";
import { formatCurlCommand } from "../curl";
import { parseCurlToHttpSpec, curlToHttpFileLines } from "../curl";
import type { KulalaPromptResponse } from "./types";
import type { ScriptFlowContext } from "./scripts";

export type RequestCursorInput = {
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
  userAgent?: string;
};

export type InspectRequestResult =
  | { ok: true; lines: string[] }
  | { ok: false; error: string }
  | KulalaPromptResponse;

export type ToCurlResult =
  | { ok: true; curl: string }
  | { ok: false; error: string }
  | KulalaPromptResponse;

export type FromCurlResult =
  | { ok: true; lines: string[] }
  | { ok: false; error: string };

export async function inspectRequestAtCursor(
  input: RequestCursorInput,
): Promise<InspectRequestResult> {
  const doc = await getDocument(input.content, input.filepath);
  const blocks = findBlocksAtCursor(doc, {
    line: input.line,
    column: input.column,
  });
  const block = blocks[0];
  if (!block) {
    return { ok: false, error: "No request found at cursor position" };
  }

  const env = input.env ?? "default";
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, input.content);
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
  );
  if ("prompt" in resolved && resolved.prompt) return resolved;
  if (!("ok" in resolved) || !resolved.ok) {
    return {
      ok: false,
      error: "error" in resolved ? resolved.error : "Failed to resolve request",
    };
  }
  return { ok: true, lines: resolvedRequestToInspectLines(resolved.request) };
}

export async function toCurlAtCursor(
  input: RequestCursorInput,
): Promise<ToCurlResult> {
  const doc = await getDocument(input.content, input.filepath);
  const blocks = findBlocksAtCursor(doc, {
    line: input.line,
    column: input.column,
  });
  const block = blocks[0];
  if (!block) {
    return { ok: false, error: "No request found at cursor position" };
  }

  const env = input.env ?? "default";
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const stableDocId = getStableDocumentId(doc.filepath, input.content);
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
  );
  if ("prompt" in resolved && resolved.prompt) return resolved;
  if (!("ok" in resolved) || !resolved.ok) {
    return {
      ok: false,
      error: "error" in resolved ? resolved.error : "Failed to resolve request",
    };
  }
  const r = resolved.request;
  const curl = formatCurlCommand({
    method: r.method,
    url: r.url,
    headers: r.headers,
    body: r.body,
    httpVersion: r.httpVersion,
    insecure: r.insecure,
    userAgent:
      input.userAgent ?? r.headers["User-Agent"] ?? r.headers["user-agent"],
  });
  return { ok: true, curl };
}

export function fromCurlCommand(curl: string): FromCurlResult {
  const parsed = parseCurlToHttpSpec(curl);
  if (!parsed) {
    return { ok: false, error: "Failed to parse curl command" };
  }
  return {
    ok: true,
    lines: curlToHttpFileLines(
      {
        method: parsed.spec.method,
        url: parsed.spec.url,
        headers: parsed.spec.headers,
        cookie: parsed.spec.cookie,
        body: parsed.spec.bodyLines,
        httpVersion: parsed.spec.httpVersion,
      },
      parsed.curlOneLiner,
    ),
  };
}
