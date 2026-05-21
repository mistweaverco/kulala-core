import type { KulalaBlock } from "../parser/types/block";
import { OAuth2Manager } from "../auth/oauth2/manager";
import { OAuth2PromptError } from "../auth/oauth2/prompt-error";
import {
  buildMultipartBody,
  ensureMultipartContentTypeHeader,
  getFormRequestBody,
  getGraphQLRequestBody,
  getJSONRequestBody,
  getRequestHeaderType,
  isBodyFromFileRef,
  isRawMultipartTemplateBody,
  resolveBodyFromFile,
  resolveInlineBodyFileRefs,
  stripHttpClientDoubleSlashLineComments,
} from "./body";
import {
  buildHeadersFromSection,
  normalizeAuthorizationHeader,
  setUserAgentHeaderIfNotPresent,
} from "./headers";
import { bodyPayloadToScriptString } from "./script-request-context";
import {
  detectCollectionIterationPlan,
  varsForCollectionIndex,
} from "./collection-iteration";
import { runScripts, type ScriptFlowContext } from "./scripts";
import { buildScriptRequestContextFromBlock } from "./script-request-context";
import {
  applyDefaultHeaders,
  loadDefaultHeaders,
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

export type ResolvedRequestPreview = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  httpVersion?: string;
  insecure?: boolean;
};

export type ResolveRequestResult =
  | { ok: true; request: ResolvedRequestPreview }
  | { ok: false; error: string }
  | KulalaPromptResponse;

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
): Promise<ResolveRequestResult> {
  const startDir = filePath
    ? (await import("path")).dirname(filePath)
    : process.cwd();
  const mutableVars = { ...(vars ?? {}) };
  const getOps = (names: string[]) =>
    block.operators.filter((o) => names.includes(o.name));
  const getOpArgs = (names: string[]): string | undefined =>
    getOps(names)
      .map((o) => String(o.args ?? ""))
      .find((s) => s.trim() !== "");
  const hasOp = (names: string[]): boolean => getOps(names).length > 0;
  const insecure = hasOp(["kulala-curl-insecure"]);

  const oauth2Manager = new OAuth2Manager(env, startDir);
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token") return oauth2Manager.getAccessToken(authId);
    return oauth2Manager.getIdToken(authId);
  };

  let effectiveBody: typeof block.request.body = block.request.body;
  if (isBodyFromFileRef(effectiveBody)) {
    effectiveBody = await resolveBodyFromFile(
      effectiveBody.__bodyFromFile,
      startDir,
    );
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
  await runScripts(
    block.scripts.preRequest,
    "preRequest",
    block,
    filePath,
    undefined,
    mutableVars,
    flow,
    undefined,
    preScriptRequestCtx,
  );

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
  const needsAsyncSubstitution =
    urlStr.includes("$auth.") ||
    headerStr.includes("$auth.") ||
    bodyStrCheck.includes("$auth.");

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
  if (flow?.globalHeaders) {
    const existingLc = new Set(
      Object.keys(headers).map((k) => k.toLowerCase()),
    );
    for (const [k, v] of Object.entries(flow.globalHeaders)) {
      if (!existingLc.has(k.toLowerCase())) headers[k] = v;
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

  let body: typeof block.request.body;
  try {
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
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  const methodUpper = (block.request.method || "GET").toUpperCase();
  if (methodUpper === "GRPC" || methodUpper === "WS" || methodUpper === "WSS") {
    return {
      ok: false,
      error: `${methodUpper} requests cannot be shown as curl or HTTP inspect preview`,
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
    typeof body === "string"
  ) {
    try {
      json = JSON.parse(body) as Record<string, unknown>;
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
  } else if (typeof body === "string" && body.length > 0) {
    bodyPayload = body;
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
      method: sent.method,
      url: sent.url,
      headers: sent.headers ?? {},
      body: sent.body,
      httpVersion: block.request.httpVersion,
      insecure,
    },
  };
}

export function resolvedRequestToInspectLines(
  preview: ResolvedRequestPreview,
): string[] {
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
