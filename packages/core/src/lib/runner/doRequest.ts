import { httpRequest } from "./http-client";
import { grpcNativeRequest } from "../grpc";
import { grpcFlagsFromOperators } from "../grpc/collect-flags";
import { mergeGrpcFlags } from "../grpc/parse-target";
import type { KulalaWebSocketPlanResponse } from "./types";
import type { KulalaBlock } from "../parser/types/block";
import {
  substituteInObject,
  substituteInObjectAsync,
  substituteInString,
  substituteInStringAsync,
} from "../variables";
import { OAuth2Manager } from "../auth/oauth2/manager";
import { OAuth2PromptError } from "../auth/oauth2/prompt-error";
import {
  createPrompt,
  deleteVariable,
  getCookieHeaderForRequest,
  incrementReplayCount,
  saveHistoryEntry,
  setVariable,
  storeCookiesFromResponse,
} from "../persistence";
import { runScripts } from "./scripts";
import {
  buildHeadersFromSection,
  normalizeAuthorizationHeader,
  setUserAgentHeaderIfNotPresent,
} from "./headers";
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
import type {
  KulalaPromptResponse,
  KulalaRequestErrorResponse,
  KulalaRequestSent,
  KulalaRequestSuccessResponse,
  KulalaScriptConsoleLine,
  RunnerResponseLike,
  VariableResolver,
} from "./types";

export type { RunnerResponseLike } from "./types";

function buildSentRequestSnapshot(
  method: string,
  url: string,
  headers: Record<string, string>,
  bodyPayload: string | Buffer | FormData | undefined,
): KulalaRequestSent {
  let body: string | undefined;
  if (typeof bodyPayload === "string") body = bodyPayload;
  else if (Buffer.isBuffer(bodyPayload)) body = bodyPayload.toString("utf-8");
  return {
    method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

export async function doRequestFromBlock(
  block: KulalaBlock,
  filePath: string | undefined,
  vars: Record<string, string> | undefined,
  stableDocIdForReplay: string | undefined,
  resolver: VariableResolver | undefined,
  env: string = "default",
  flow?: import("./scripts").ScriptFlowContext,
): Promise<
  | KulalaRequestSuccessResponse
  | KulalaRequestErrorResponse
  | KulalaPromptResponse
  | KulalaWebSocketPlanResponse
> {
  const scriptConsole: KulalaScriptConsoleLine[] = [];

  const parseDurationToSec = (raw: string): number | undefined => {
    const s = raw.trim();
    if (!s) return undefined;
    const m = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i);
    if (!m) return undefined;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return undefined;
    const unit = (m[2] ?? "s").toLowerCase();
    if (unit === "ms") return n / 1000;
    if (unit === "m") return n * 60;
    return n;
  };

  const parseCurlPassthroughSeconds = (raw: string): number | undefined => {
    const s = raw.trim();
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return n;
  };

  const parsePromptArgs = (
    raw: string,
  ): { varName: string; label?: string } | null => {
    const s = raw.trim();
    if (!s) return null;

    // Back-compat: "@prompt NAME"
    if (!s.startsWith(`"`) && !s.startsWith(`'`)) {
      const parts = s.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return { varName: parts[0]! };
      if (parts.length >= 2) {
        const varName = parts[parts.length - 1]!;
        const label = parts.slice(0, -1).join(" ");
        return { varName, label };
      }
      return null;
    }

    // Quoted label: @"What is your name?" NAME
    const quote = s[0]!;
    let i = 1;
    let label = "";
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "\\") {
        const next = s[i + 1];
        if (next !== undefined) {
          label += next;
          i += 2;
          continue;
        }
      }
      if (ch === quote) break;
      label += ch;
      i += 1;
    }
    if (i >= s.length || s[i] !== quote) return null;
    const rest = s.slice(i + 1).trim();
    const varName = rest.split(/\s+/).filter(Boolean)[0];
    if (!varName) return null;
    return { varName, label };
  };

  // Initialize OAuth2 manager if needed
  const startDir = filePath
    ? (await import("path")).dirname(filePath)
    : process.cwd();
  const oauth2Manager = new OAuth2Manager(env, startDir);
  const authResolver = async (
    func: "token" | "idToken",
    authId: string,
  ): Promise<string | undefined> => {
    if (func === "token") {
      return await oauth2Manager.getAccessToken(authId);
    } else {
      return await oauth2Manager.getIdToken(authId);
    }
  };

  // Pre-request scripts may set variables that affect substitution.
  // Keep `vars` mutable within this block.
  const mutableVars = vars ?? {};

  const stableDocId = stableDocIdForReplay ?? filePath ?? "";
  const getOps = (names: string[]) =>
    block.operators.filter((o) => names.includes(o.name));
  const getOpArgs = (names: string[]): string | undefined =>
    getOps(names)
      .map((o) => String(o.args ?? ""))
      .find((s) => s.trim() !== "");
  const hasOp = (names: string[]): boolean => getOps(names).length > 0;
  const cookieJarEnabled = !hasOp(["no-cookie-jar"]);
  const logEnabled = !hasOp(["no-log"]);

  // @prompt / @kulala-prompt: request requires user input before executing.
  const promptVar = getOpArgs(["prompt", "kulala-prompt"]);
  if (promptVar) {
    const parsed = parsePromptArgs(promptVar);
    const varName = parsed?.varName?.trim() ?? "";
    const label = parsed?.label?.trim();

    // Consume one-time prompt value if it was stored for this request.
    if (stableDocId && varName && mutableVars[varName] !== undefined) {
      deleteVariable("request", varName, {
        document: stableDocId,
        blockName: block.name,
      });
    }

    if (varName && mutableVars[varName] === undefined) {
      const promptId = createPrompt("custom", {
        promptType: "custom",
        stableDocId,
        blockName: block.name,
        varName,
        label,
      });
      return {
        success: false,
        prompt: true,
        promptId,
        promptType: "custom",
        message: `Input required for variable: ${varName}`,
        inputs: [
          {
            id: varName,
            label: label && label.length > 0 ? label : varName,
            type: "text",
            required: true,
          },
        ],
      };
    }
  }

  // @kulala-file-contents-to-variable VAR PATH
  const fileToVarArgs = getOpArgs(["kulala-file-contents-to-variable"]);
  if (fileToVarArgs) {
    const parts = fileToVarArgs.trim().split(/\s+/);
    const varName = parts.shift();
    const relPath = parts.join(" ").trim();
    if (varName && relPath) {
      const pathMod = await import("path");
      const fs = await import("fs/promises");
      const resolved = pathMod.resolve(startDir, relPath);
      const content = await fs.readFile(resolved, "utf-8");
      mutableVars[varName] = content;
      if (stableDocId) {
        setVariable("document", varName, content, { document: stableDocId });
      }
    }
  }

  // Resolve body-from-file (JetBrains-style "< path") so we have effective body for substitution and send
  let effectiveBody: typeof block.request.body = block.request.body;
  if (isBodyFromFileRef(effectiveBody)) {
    effectiveBody = await resolveBodyFromFile(
      effectiveBody.__bodyFromFile,
      startDir,
    );
  }

  // Pre-request scripts run before substitution so they can set request/global vars.
  await runScripts(
    block.scripts.preRequest,
    "preRequest",
    block,
    filePath,
    undefined,
    mutableVars,
    flow,
    scriptConsole,
  );

  // Check if we need async substitution (for $auth.token() calls)
  // Unescape braces in header values before checking (similar to header parser)
  const unescapeBraces = (str: string): string => {
    return str.replace(/\\+{/g, "{").replace(/\\+}/g, "}");
  };
  const urlStr = typeof block.request.url === "string" ? block.request.url : "";
  // Unescape braces in header values before stringifying to detect $auth. correctly
  const headerSectionWithUnescapedBraces = block.request.headerSection.map(
    (entry) =>
      entry.type === "header" && entry.value
        ? { ...entry, value: unescapeBraces(entry.value) }
        : entry,
  );
  const headerStr = JSON.stringify(headerSectionWithUnescapedBraces);
  const bodyStr = JSON.stringify(effectiveBody ?? {});
  const needsAsyncSubstitution =
    urlStr.includes("$auth.") ||
    headerStr.includes("$auth.") ||
    bodyStr.includes("$auth.");

  let url: string;
  try {
    url = needsAsyncSubstitution
      ? await substituteInStringAsync(
          block.request.url,
          mutableVars,
          resolver,
          authResolver,
        )
      : substituteInString(block.request.url, mutableVars, resolver);
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  let headers = setUserAgentHeaderIfNotPresent(
    buildHeadersFromSection(block.request.headerSection),
  );
  const accept = getOpArgs(["accept"]);
  if (
    accept &&
    !Object.keys(headers).some((k) => k.toLowerCase() === "accept")
  ) {
    headers.Accept = accept;
  }
  // JetBrains parity: global headers are applied implicitly to outgoing requests
  // within the same execution flow, but should not override explicit request headers.
  if (flow?.globalHeaders) {
    const existingLc = new Set(
      Object.keys(headers).map((k) => k.toLowerCase()),
    );
    for (const [k, v] of Object.entries(flow.globalHeaders)) {
      if (!existingLc.has(k.toLowerCase())) headers[k] = v;
    }
  }
  if (needsAsyncSubstitution || Object.keys(mutableVars).length > 0) {
    try {
      const substitutedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        substitutedHeaders[k] = needsAsyncSubstitution
          ? await substituteInStringAsync(
              v,
              mutableVars,
              resolver,
              authResolver,
            )
          : substituteInString(v, mutableVars, resolver);
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
          mutableVars,
          resolver,
          authResolver,
        )) as typeof block.request.body)
      : (substituteInObject(
          effectiveBody,
          mutableVars,
          resolver,
        ) as typeof block.request.body);
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  const requestHeaderType = getRequestHeaderType(headers);
  const isGraphQL = block.request.method === "GRAPHQL";
  const noAutoEncoding = hasOp(["no-auto-encoding"]);
  const graphqlBody = isGraphQL ? getGraphQLRequestBody(body) : undefined;
  let json =
    !isGraphQL && requestHeaderType === "json"
      ? getJSONRequestBody(body)
      : undefined;
  // Body-from-file yields a string; parse as JSON when Content-Type is json
  if (
    json === undefined &&
    requestHeaderType === "json" &&
    typeof body === "string"
  ) {
    try {
      json = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // leave json undefined, may fall through to raw body
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

  let rawMultipartBody: Buffer | undefined;
  if (rawMultipartTemplate) {
    const text = stripHttpClientDoubleSlashLineComments(body as string);
    headers = ensureMultipartContentTypeHeader(headers, text);
    rawMultipartBody = await resolveInlineBodyFileRefs(text, startDir);
  }

  let multipartBody: FormData | undefined;
  if (
    !rawMultipartTemplate &&
    formDataBody &&
    typeof formDataBody === "object" &&
    Object.keys(formDataBody).length > 0
  ) {
    multipartBody = await buildMultipartBody(
      formDataBody as Record<string, unknown>,
      startDir,
    );
    headers = Object.fromEntries(
      Object.entries(headers).filter(
        ([k]) => k.toLowerCase() !== "content-type",
      ),
    );
  }

  const methodUpper = (block.request.method || "GET").toUpperCase();

  if (methodUpper === "WS" || methodUpper === "WSS") {
    const bodyStr =
      typeof body === "string"
        ? body
        : body != null
          ? JSON.stringify(body)
          : "";
    return {
      success: true,
      protocol: "websocket",
      url,
      initialMessage: bodyStr || undefined,
      request: buildSentRequestSnapshot(
        methodUpper,
        url,
        headers,
        bodyStr || undefined,
      ),
    };
  }

  if (methodUpper === "GRPC") {
    const grpcFlags = mergeGrpcFlags(
      flow?.sharedGrpcFlags ?? [],
      grpcFlagsFromOperators(block.operators, startDir),
    );
    const grpcRes = await grpcNativeRequest({
      target: url,
      grpcCommand: block.request.grpcCommand,
      metadataFlags: grpcFlags,
      headers,
      body:
        typeof body === "string"
          ? body
          : body != null
            ? JSON.stringify(body)
            : undefined,
      cwd: startDir,
      insecure: getOps(["kulala-curl-insecure"]).length > 0,
    });
    const ok = grpcRes.statusCode >= 200 && grpcRes.statusCode < 400;
    if (!ok) {
      return {
        success: false,
        error: grpcRes.body || grpcRes.stderr || "gRPC request failed",
      };
    }
    const grpcBodyRaw = grpcRes.body ?? "";
    let grpcBodyParsed: unknown = null;
    try {
      grpcBodyParsed = JSON.parse(grpcBodyRaw);
    } catch {
      // text response
    }
    const grpcResponseBody =
      grpcBodyParsed !== null && typeof grpcBodyParsed === "object"
        ? {
            type: "json" as const,
            content: grpcBodyParsed as Record<string, unknown>,
          }
        : { type: "text" as const, content: grpcBodyRaw };
    const grpcBodyText =
      typeof body === "string"
        ? body
        : body != null
          ? JSON.stringify(body)
          : undefined;
    return {
      success: true,
      status: grpcRes.statusCode,
      headers: {
        "content-type": ok ? "application/json" : "kulala/grpc_error",
      },
      url,
      request: buildSentRequestSnapshot("GRPC", url, headers, grpcBodyText),
      timings: {
        dns: 0,
        tcp: 0,
        tls: 0,
        request: 0,
        redirect: 0,
        firstByte: grpcRes.timings.total,
        startTransfer: grpcRes.timings.total,
        total: grpcRes.timings.total,
      },
      body: grpcResponseBody,
      scriptConsole: scriptConsole.length > 0 ? scriptConsole : undefined,
    };
  }

  const method = (isGraphQL ? "POST" : block.request.method) || "GET";
  const requestHeaders: Record<string, string> = isGraphQL
    ? { ...headers, "Content-Type": "application/json" }
    : headers;

  const insecureOp = getOps(["kulala-curl-insecure"]).length > 0;
  const timeoutSecJetBrains = parseDurationToSec(getOpArgs(["timeout"]) ?? "");
  const connectionTimeoutSecJetBrains = parseDurationToSec(
    getOpArgs(["connection-timeout"]) ?? "",
  );
  const timeoutSecCurl = parseCurlPassthroughSeconds(
    getOpArgs(["kulala-curl-timeout"]) ?? "",
  );
  const connectionTimeoutSecCurl = parseCurlPassthroughSeconds(
    getOpArgs(["kulala-curl-connect-timeout"]) ?? "",
  );
  const effectiveTimeoutSec =
    timeoutSecCurl ?? timeoutSecJetBrains ?? undefined;
  const effectiveConnectionTimeoutSec =
    connectionTimeoutSecCurl ?? connectionTimeoutSecJetBrains ?? undefined;
  const followRedirects = !hasOp(["no-redirect"]);

  try {
    let bodyPayload: string | Buffer | FormData | undefined;
    if (multipartBody) {
      bodyPayload = multipartBody;
    } else if (rawMultipartBody) {
      bodyPayload = rawMultipartBody;
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
        const pairs = Object.entries(form as Record<string, string>);
        bodyPayload = pairs.map(([k, v]) => `${k}=${v}`).join("&");
      } else {
        bodyPayload = new URLSearchParams(
          form as Record<string, string>,
        ).toString();
      }
    } else if (typeof body === "string" && body.length > 0) {
      bodyPayload = body;
    }

    // Cookie jar: apply stored cookies unless disabled or explicitly set by user.
    if (
      cookieJarEnabled &&
      !Object.keys(requestHeaders).some((k) => k.toLowerCase() === "cookie")
    ) {
      const cookie = getCookieHeaderForRequest(url);
      if (cookie) requestHeaders.Cookie = cookie;
    }

    const res = await httpRequest({
      url,
      method,
      headers: requestHeaders,
      body: bodyPayload,
      httpVersion: block.request.httpVersion,
      insecure: insecureOp,
      timeoutSec: effectiveTimeoutSec,
      connectionTimeoutSec: effectiveConnectionTimeoutSec,
      followRedirects,
      propagateCookiesOnRedirect: cookieJarEnabled,
      cookieJarEnabled,
    });

    const rawBody = res.body;
    const rawBodyStr =
      typeof rawBody === "string" ? rawBody : String(rawBody ?? "");

    // Cookie jar: store Set-Cookie response headers unless disabled.
    if (cookieJarEnabled) {
      // Persist cookies from redirect chain too (servers often set cookies on 302).
      if (res.redirectChain && res.redirectChain.length > 0) {
        for (const hop of res.redirectChain) {
          const hopSetCookieRaw = hop.headers["set-cookie"];
          if (
            typeof hopSetCookieRaw === "string" &&
            hopSetCookieRaw.trim().length > 0
          ) {
            const lines = hopSetCookieRaw
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean);
            if (lines.length > 0) storeCookiesFromResponse(hop.url, lines);
          }
        }
      }
      const setCookieRaw = res.headers["set-cookie"];
      if (typeof setCookieRaw === "string" && setCookieRaw.trim().length > 0) {
        const lines = setCookieRaw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length > 0) storeCookiesFromResponse(url, lines);
      }
    }
    const contentType = res.headers["content-type"] || "";
    let jsonBody: Record<string, unknown> | null = null;
    if (contentType.toLowerCase().includes("json")) {
      try {
        jsonBody = JSON.parse(rawBodyStr);
      } catch {
        // ignore JSON parse errors, treat as text
      }
    }
    const responseBody =
      jsonBody !== null
        ? {
            type: "json" as const,
            content: jsonBody as Record<string, unknown>,
          }
        : {
            type: "text" as const,
            content: rawBodyStr,
          };

    const mapChainEntry = (
      entry: NonNullable<typeof res.redirectChain>[number],
    ): NonNullable<KulalaRequestSuccessResponse["redirectChain"]>[number] => {
      const raw = entry.body;
      const rawStr = typeof raw === "string" ? raw : String(raw ?? "");
      const ct = entry.headers["content-type"] || "";
      let json: Record<string, unknown> | null = null;
      if (ct.toLowerCase().includes("json")) {
        try {
          json = JSON.parse(rawStr);
        } catch {
          // ignore
        }
      }
      const body =
        json !== null
          ? { type: "json" as const, content: json }
          : { type: "text" as const, content: rawStr };
      const p = entry.timings.phases;
      return {
        status: entry.statusCode,
        headers: entry.headers,
        url: entry.url,
        body,
        timings: {
          dns: p.dns ?? 0,
          tcp: p.tcp ?? 0,
          tls: p.tls ?? 0,
          request: p.request ?? 0,
          redirect: p.redirect ?? 0,
          firstByte: p.firstByte ?? 0,
          startTransfer: p.startTransfer ?? 0,
          total: p.total ?? 0,
        },
        ...(entry.verboseTrace ? { verboseTrace: entry.verboseTrace } : {}),
      };
    };

    // Redirect response to file (>> path or >>! path)
    const redirect = block.request.responseRedirect;
    if (redirect?.filePath) {
      const pathMod = await import("path");
      const fs = await import("fs/promises");
      const resolved = pathMod.resolve(startDir, redirect.filePath);
      await fs.mkdir(pathMod.dirname(resolved), { recursive: true });
      const isBuffer = Buffer.isBuffer(rawBody);
      const bodyToWrite: string | Buffer =
        typeof rawBody === "string"
          ? rawBody
          : isBuffer
            ? rawBody
            : String(rawBody ?? "");
      const writeOpts: { encoding?: BufferEncoding } = isBuffer
        ? {}
        : { encoding: "utf-8" };
      if (redirect.overwrite) {
        await fs.writeFile(resolved, bodyToWrite, writeOpts);
      } else {
        let target = resolved;
        let n = 0;
        const ext = pathMod.extname(resolved);
        const base = resolved.slice(0, -ext.length || undefined);
        while (true) {
          try {
            await fs.access(target);
            n += 1;
            target = n === 1 ? `${base}-1${ext}` : `${base}-${n}${ext}`;
          } catch {
            await fs.writeFile(target, bodyToWrite, writeOpts);
            break;
          }
        }
      }
    }

    const { phases } = res.timings;
    const total = phases.total ?? 0;
    const firstByte = phases.firstByte ?? 0;
    const startTransfer = phases.startTransfer ?? 0;
    const redirectTime = phases.redirect ?? 0;
    const timingsForScripts: RunnerResponseLike["timings"] = {
      phases: { ...phases },
    };
    const responseLike: RunnerResponseLike = {
      body: rawBody,
      statusCode: res.statusCode,
      headers: res.headers,
      timings: timingsForScripts,
    };

    await runScripts(
      block.scripts.postRequest,
      "postRequest",
      block,
      filePath,
      responseLike,
      undefined,
      flow,
      scriptConsole,
    );

    // @kulala-expect-status-code 200 (or 200,201)
    const expectArgs = getOpArgs(["kulala-expect-status-code"]);
    if (expectArgs) {
      const codes = expectArgs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n));
      if (codes.length > 0 && !codes.includes(res.statusCode)) {
        return {
          success: false,
          error: `Expected status code ${codes.join(
            ", ",
          )} but got ${res.statusCode}`,
          ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
        } as KulalaRequestErrorResponse;
      }
    }

    incrementReplayCount(stableDocIdForReplay ?? filePath ?? "", block.name);

    if (logEnabled) {
      saveHistoryEntry({
        stableDocId: stableDocId || undefined,
        blockName: block.name,
        method,
        url,
        requestHeaders,
        requestBodyText:
          typeof bodyPayload === "string"
            ? bodyPayload
            : Buffer.isBuffer(bodyPayload)
              ? bodyPayload.toString("utf-8")
              : undefined,
        statusCode: res.statusCode,
        responseHeaders: res.headers,
        responseBodyText: rawBodyStr,
      });
    }

    return {
      success: true,
      status: res.statusCode,
      headers: res.headers,
      url: res.url,
      request: buildSentRequestSnapshot(
        method,
        url,
        requestHeaders,
        bodyPayload,
      ),
      ...(res.redirectChain
        ? { redirectChain: res.redirectChain.map(mapChainEntry) }
        : {}),
      timings: {
        dns: phases.dns ?? 0,
        tcp: phases.tcp ?? 0,
        tls: phases.tls ?? 0,
        request: phases.request ?? 0,
        redirect: redirectTime,
        firstByte,
        startTransfer,
        total,
      },
      body: responseBody,
      ...(res.verboseTrace ? { verboseTrace: res.verboseTrace } : {}),
      ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
    } as KulalaRequestSuccessResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      ...(scriptConsole.length > 0 ? { scriptConsole } : {}),
    } as KulalaRequestErrorResponse;
  }
}
