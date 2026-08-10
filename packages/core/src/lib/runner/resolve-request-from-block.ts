import { encodeRequestUrl } from "./encode-url";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import {
  getEffectiveCurlArgv,
  getEffectiveOperators,
} from "./effective-operators";
import { OAuth2Manager } from "../auth/oauth2/manager";
import { OAuth2PromptError } from "../auth/oauth2/prompt-error";
import { ScriptPromptError } from "./script-prompt-error";
import { getVariable } from "../persistence";
import {
  MAX_SCRIPT_REPLAYS,
  ScriptAbortError,
  ScriptReplayError,
  ScriptSkipError,
} from "./script-control-error";
import {
  applyRawBodyWithoutContentType,
  buildMultipartBody,
  ensureMultipartContentTypeHeader,
  getFormRequestBody,
  getGraphQLRequestBody,
  getJSONRequestBody,
  getRequestHeaderType,
  graphQLRawSubstitutionText,
  isBodyFromFileRef,
  isRawMultipartTemplateBody,
  resolveEffectiveBodyFromFileRef,
  resolveInlineBodyFileRefs,
  stripHttpClientDoubleSlashLineComments,
  substituteGraphQLRequestBody,
} from "./body";
import {
  buildHeadersFromSection,
  normalizeAuthorizationHeader,
  setUserAgentHeaderIfNotPresent,
} from "./headers";
import { bodyPayloadToScriptString } from "./script-request-context";
import { grpcFlagsFromOperators } from "../grpc/collect-flags";
import { formatGrpcurlCommand } from "../grpc/format";
import { mergeGrpcFlags, parseGrpcTarget } from "../grpc/parse-target";
import type { KulalaGrpcCommand, KulalaGrpcFlag } from "../grpc/types";
import { curlArgvHasFlag } from "../curl/passthrough";
import { formatWebsocatCommand } from "../websocket/format";
import {
  detectCollectionIterationPlan,
  varsForCollectionIndex,
} from "./collection-iteration";
import {
  runScripts,
  type ScriptFlowContext,
  type ScriptRunScope,
} from "./scripts";
import { buildScriptRequestContextFromBlock } from "./script-request-context";
import {
  applyDefaultHeaders,
  loadDefaultHeaders,
  resolveUrlFromHostHeader,
  substituteInObject,
  substituteInObjectAsync,
  substituteInString,
  substituteInStringAsync,
} from "../variables";
import type {
  KulalaPromptResponse,
  KulalaRequestSent,
  VariableResolver,
} from "./types";

const CLIENT_GLOBAL_HEADERS_VAR = "__kulala_client_global_headers__";

function readClientGlobalHeaders(): Record<string, string> {
  const v = getVariable("global", CLIENT_GLOBAL_HEADERS_VAR);
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === "string") out[k] = raw;
  }
  return out;
}

export type ResolvedHttpRequestPreview = {
  kind: "http";
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  httpVersion?: string;
  extraCurlArgv?: string[];
};

export type ResolvedGrpcRequestPreview = {
  kind: "grpc";
  grpcCommand: KulalaGrpcCommand;
  flags: KulalaGrpcFlag[];
  headers: Record<string, string>;
  body?: string;
  cwd: string;
  vars?: Record<string, string>;
  insecure?: boolean;
};

export type ResolvedWebSocketRequestPreview = {
  kind: "websocket";
  url: string;
  headers: Record<string, string>;
  body?: string;
};

export type ResolvedRequestPreview =
  | ResolvedHttpRequestPreview
  | ResolvedGrpcRequestPreview
  | ResolvedWebSocketRequestPreview;

export type ResolveRequestResult =
  | { ok: true; request: ResolvedRequestPreview }
  | { ok: false; error: string }
  | KulalaPromptResponse
  | { ok: false; skipped: true };

/**
 * Resolve URL, headers, and body as they would be sent (pre-request scripts + substitution).
 * Does not perform the HTTP request.
 */
export async function resolveRequestFromBlock(
  block: KulalaBlock,
  filePath: string | undefined,
  vars: Record<string, string> | undefined,
  resolver: VariableResolver | undefined,
  env: string = "default",
  flow?: ScriptFlowContext,
  doc?: KulalaDocument,
): Promise<ResolveRequestResult> {
  const startDir = filePath
    ? (await import("path")).dirname(filePath)
    : process.cwd();
  const stableDocId = filePath ?? "";
  const scriptRunScope: ScriptRunScope = {
    stableDocId,
    doc,
    env,
    resolver,
    runRequestStack: [],
  };
  const mutableVars = { ...(vars ?? {}) };
  const effectiveOperators = getEffectiveOperators(doc, block);
  const extraCurlArgv = getEffectiveCurlArgv(doc, block, env, startDir);
  const getOps = (names: string[]) =>
    effectiveOperators.filter((o) => names.includes(o.name));
  const getOpArgs = (names: string[]): string | undefined =>
    getOps(names)
      .map((o) => String(o.args ?? ""))
      .find((s) => s.trim() !== "");
  const hasOp = (names: string[]): boolean => getOps(names).length > 0;
  const oauth2Manager = new OAuth2Manager(env, startDir, mutableVars);
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    // Preview/inspect paths must not start OAuth flows (e.g. LSP hover).
    const authOptions = { acquire: false as const };
    if (func === "token") {
      return oauth2Manager.getAccessToken(authId, authOptions);
    }
    return oauth2Manager.getIdToken(authId, authOptions);
  };

  let effectiveBody: typeof block.request.body = block.request.body;
  if (isBodyFromFileRef(effectiveBody)) {
    effectiveBody = await resolveEffectiveBodyFromFileRef(
      effectiveBody,
      startDir,
      block.request.method,
    );
  }

  let scriptReplayIndex = 0;
  scriptReplay: while (true) {
    if (scriptReplayIndex > MAX_SCRIPT_REPLAYS) {
      return {
        ok: false,
        error: `Too many $kulala.request.replay() calls (max ${MAX_SCRIPT_REPLAYS})`,
      };
    }
    const preScriptRequestCtx = buildScriptRequestContextFromBlock({
      block,
      phase: "preRequest",
      effectiveBody,
      env,
      startDir,
      mutableVars,
      resolver,
      iteration: 0,
    });
    try {
      // Important: capture script console output so the caller can safely serialize
      // JSON responses (e.g. stdin actions like inspect_request).
      const scriptConsole: import("./types").KulalaScriptConsoleLine[] = [];
      await runScripts(
        block.scripts.preRequest,
        "preRequest",
        block,
        filePath,
        undefined,
        mutableVars,
        flow,
        scriptConsole,
        preScriptRequestCtx,
        scriptRunScope,
      );
    } catch (error) {
      if (error instanceof ScriptPromptError) {
        return error.promptResponse;
      }
      if (error instanceof ScriptSkipError) {
        return { ok: false, skipped: true };
      }
      if (error instanceof ScriptAbortError) {
        return { ok: false, error: error.message };
      }
      if (error instanceof ScriptReplayError) {
        scriptReplayIndex += 1;
        continue scriptReplay;
      }
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    break;
  }

  const collectionPlan = detectCollectionIterationPlan(
    block,
    effectiveBody,
    mutableVars,
  );
  const activeVars =
    collectionPlan.count > 1
      ? varsForCollectionIndex(mutableVars, collectionPlan.collections, 0)
      : mutableVars;

  const unescapeBraces = (str: string): string =>
    str.replace(/\\+{/g, "{").replace(/\\+}/g, "}");
  const urlStr = typeof block.request.url === "string" ? block.request.url : "";
  const headerSectionWithUnescapedBraces = block.request.headerSection.map(
    (entry) =>
      entry.type === "header" && entry.value
        ? { ...entry, value: unescapeBraces(entry.value) }
        : entry,
  );
  const headerStr = JSON.stringify(headerSectionWithUnescapedBraces);
  const bodyStrCheck = JSON.stringify(effectiveBody ?? {});
  const graphqlRawText = graphQLRawSubstitutionText(
    block.request.body,
    block.request.sourceBodyText,
  );
  const needsAsyncSubstitution =
    urlStr.includes("$auth.") ||
    headerStr.includes("$auth.") ||
    bodyStrCheck.includes("$auth.") ||
    (graphqlRawText?.includes("$auth.") ?? false);

  let url: string;
  try {
    url = needsAsyncSubstitution
      ? await substituteInStringAsync(
          block.request.url,
          activeVars,
          resolver,
          authResolver,
        )
      : substituteInString(block.request.url, activeVars, resolver);
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  let headers = setUserAgentHeaderIfNotPresent(
    buildHeadersFromSection(block.request.headerSection),
  );
  const envDefaultHeaders = loadDefaultHeaders(env, startDir);
  if (Object.keys(envDefaultHeaders).length > 0) {
    const withDefaults = applyDefaultHeaders({
      headers,
      url,
      defaultHeaders: envDefaultHeaders,
    });
    headers = withDefaults.headers;
    url = withDefaults.url;
  }
  const accept = getOpArgs(["accept"]);
  if (
    accept &&
    !Object.keys(headers).some((k) => k.toLowerCase() === "accept")
  ) {
    headers.Accept = accept;
  }
  {
    const explicitLc = new Set(
      Object.keys(headers).map((k) => k.toLowerCase()),
    );
    const clientHeaders = readClientGlobalHeaders();
    for (const [k, v] of Object.entries(clientHeaders)) {
      if (!explicitLc.has(k.toLowerCase())) headers[k] = v;
    }
  }
  if (flow?.globalHeaders) {
    const explicitLc = new Set(
      Object.keys(headers).map((k) => k.toLowerCase()),
    );
    for (const [k, v] of Object.entries(flow.globalHeaders)) {
      if (!explicitLc.has(k.toLowerCase())) headers[k] = v;
    }
  }
  if (needsAsyncSubstitution || Object.keys(activeVars).length > 0) {
    try {
      const substitutedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        substitutedHeaders[k] = needsAsyncSubstitution
          ? await substituteInStringAsync(v, activeVars, resolver, authResolver)
          : substituteInString(v, activeVars, resolver);
      }
      headers = substitutedHeaders;
    } catch (error) {
      if (error instanceof OAuth2PromptError) {
        return error.promptResponse;
      }
      throw error;
    }
  }
  headers = normalizeAuthorizationHeader(headers);
  ({ headers, url } = resolveUrlFromHostHeader({ headers, url }));
  if (!hasOp(["no-auto-encoding"])) {
    url = encodeRequestUrl(url, block.request.method);
  }

  let body: typeof block.request.body;
  try {
    if (block.request.method === "GRAPHQL") {
      body = (await substituteGraphQLRequestBody({
        method: block.request.method,
        originalBody: block.request.body,
        effectiveBody,
        sourceBodyText: block.request.sourceBodyText,
        vars: activeVars,
        resolver,
        authResolver,
        needsAsyncSubstitution,
      })) as typeof block.request.body;
    } else {
      body = needsAsyncSubstitution
        ? ((await substituteInObjectAsync(
            effectiveBody,
            activeVars,
            resolver,
            authResolver,
          )) as typeof block.request.body)
        : (substituteInObject(
            effectiveBody,
            activeVars,
            resolver,
          ) as typeof block.request.body);
    }
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  const methodUpper = (block.request.method || "GET").toUpperCase();

  if (methodUpper === "GRPC") {
    const grpcFlags = mergeGrpcFlags(
      flow?.sharedGrpcFlags ?? [],
      grpcFlagsFromOperators(effectiveOperators),
    );
    const bodyStr =
      typeof body === "string"
        ? body
        : body != null
          ? JSON.stringify(body)
          : undefined;
    return {
      ok: true,
      request: {
        kind: "grpc",
        grpcCommand: parseGrpcTarget(url),
        flags: grpcFlags,
        headers,
        body: bodyStr,
        cwd: startDir,
        vars: activeVars,
        insecure:
          curlArgvHasFlag(extraCurlArgv, "--insecure") ||
          curlArgvHasFlag(extraCurlArgv, "-k"),
      },
    };
  }

  if (methodUpper === "WEBSOCKET") {
    const bodyStr =
      typeof body === "string"
        ? body
        : body != null
          ? JSON.stringify(body)
          : undefined;
    return {
      ok: true,
      request: {
        kind: "websocket",
        url,
        headers,
        body: bodyStr,
      },
    };
  }

  const requestHeaderType = getRequestHeaderType(headers);
  const isGraphQL = methodUpper === "GRAPHQL";
  const noAutoEncoding = hasOp(["no-auto-encoding"]);
  const graphqlBody = isGraphQL ? getGraphQLRequestBody(body) : undefined;
  let json =
    !isGraphQL && requestHeaderType === "json"
      ? getJSONRequestBody(body)
      : undefined;
  if (
    json === undefined &&
    requestHeaderType === "json" &&
    (typeof body === "string" || Buffer.isBuffer(body))
  ) {
    try {
      const text = typeof body === "string" ? body : body.toString("utf-8");
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  const form =
    requestHeaderType === "form-urlencoded"
      ? getFormRequestBody(body, "form-urlencoded")
      : undefined;
  const rawMultipartTemplate =
    requestHeaderType === "form-data" &&
    typeof body === "string" &&
    isRawMultipartTemplateBody(body);
  const formDataBody =
    requestHeaderType === "form-data" && !rawMultipartTemplate
      ? getFormRequestBody(body, "form-data")
      : undefined;

  let bodyPayload: string | Buffer | FormData | undefined;
  if (rawMultipartTemplate) {
    const text = stripHttpClientDoubleSlashLineComments(body as string);
    headers = ensureMultipartContentTypeHeader(headers, text);
    bodyPayload = await resolveInlineBodyFileRefs(text, startDir);
  } else if (
    formDataBody &&
    typeof formDataBody === "object" &&
    Object.keys(formDataBody).length > 0
  ) {
    bodyPayload = await buildMultipartBody(
      formDataBody as Record<string, unknown>,
      startDir,
    );
  } else if (graphqlBody !== undefined) {
    const payload: { query: string; variables?: Record<string, unknown> } = {
      query: typeof graphqlBody.query === "string" ? graphqlBody.query : "",
      ...(graphqlBody.variables != null
        ? { variables: graphqlBody.variables }
        : {}),
    };
    bodyPayload = JSON.stringify(payload);
  } else if (json !== undefined) {
    bodyPayload = JSON.stringify(json);
  } else if (form !== undefined) {
    if (noAutoEncoding) {
      bodyPayload = Object.entries(form as Record<string, string>)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    } else {
      bodyPayload = new URLSearchParams(
        form as Record<string, string>,
      ).toString();
    }
  } else if (body !== null && body !== undefined) {
    ({ headers, bodyPayload } = applyRawBodyWithoutContentType(headers, body));
  }

  const method = isGraphQL ? "POST" : methodUpper;
  const requestHeaders: Record<string, string> = isGraphQL
    ? { ...headers, "Content-Type": "application/json" }
    : headers;
  const sent: KulalaRequestSent = {
    method,
    url,
    headers: requestHeaders,
    ...(bodyPayloadToScriptString(bodyPayload)
      ? { body: bodyPayloadToScriptString(bodyPayload) }
      : {}),
  };

  return {
    ok: true,
    request: {
      kind: "http",
      method: sent.method,
      url: sent.url,
      headers: sent.headers ?? {},
      body: sent.body,
      httpVersion: block.request.httpVersion,
      extraCurlArgv,
    },
  };
}

export function resolvedRequestToInspectLines(
  preview: ResolvedRequestPreview,
): string[] {
  if (preview.kind === "grpc") {
    return [formatGrpcurlCommand(preview)];
  }
  if (preview.kind === "websocket") {
    return [formatWebsocatCommand(preview)];
  }
  const lines: string[] = [];
  const versionSuffix = preview.httpVersion ? ` ${preview.httpVersion}` : "";
  lines.push(`${preview.method} ${preview.url}${versionSuffix}`);
  for (const [k, v] of Object.entries(preview.headers)) {
    lines.push(`${k}: ${v}`);
  }
  if (preview.body && preview.body.length > 0) {
    lines.push("");
    for (const line of preview.body.split(/\r?\n/)) {
      lines.push(line);
    }
  }
  return lines;
}
