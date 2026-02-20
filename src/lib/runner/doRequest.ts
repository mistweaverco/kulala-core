import { nodeHttpRequest } from "./http-client";
import type { KulalaBlock } from "../parser/types/block";
import {
  substituteInObject,
  substituteInObjectAsync,
  substituteInString,
  substituteInStringAsync,
} from "../variables";
import { OAuth2Manager } from "../auth/oauth2/manager";
import { OAuth2PromptError } from "../auth/oauth2/prompt-error";
import { incrementReplayCount } from "../persistence";
import { runScripts } from "./scripts";
import {
  buildHeadersFromSection,
  normalizeAuthorizationHeader,
  setUserAgentHeaderIfNotPresent,
} from "./headers";
import {
  buildMultipartBody,
  getFormRequestBody,
  getGraphQLRequestBody,
  getJSONRequestBody,
  getRequestHeaderType,
  isBodyFromFileRef,
  resolveBodyFromFile,
} from "./body";
import type {
  KulalaPromptResponse,
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  RunnerResponseLike,
  VariableResolver,
} from "./types";

export type { RunnerResponseLike } from "./types";

export async function doRequestFromBlock(
  block: KulalaBlock,
  filePath: string | undefined,
  vars: Record<string, string> | undefined,
  stableDocIdForReplay: string | undefined,
  resolver: VariableResolver | undefined,
  env: string = "default",
): Promise<
  | KulalaRequestSuccessResponse
  | KulalaRequestErrorResponse
  | KulalaPromptResponse
> {
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

  // Resolve body-from-file (JetBrains-style "< path") so we have effective body for substitution and send
  let effectiveBody: typeof block.request.body = block.request.body;
  if (isBodyFromFileRef(effectiveBody)) {
    effectiveBody = await resolveBodyFromFile(
      effectiveBody.__bodyFromFile,
      startDir,
    );
  }

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
          vars ?? {},
          resolver,
          authResolver,
        )
      : vars !== undefined
        ? substituteInString(block.request.url, vars, resolver)
        : block.request.url;
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  let headers = setUserAgentHeaderIfNotPresent(
    buildHeadersFromSection(block.request.headerSection),
  );
  if (vars !== undefined || needsAsyncSubstitution) {
    try {
      const substitutedHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        substitutedHeaders[k] = needsAsyncSubstitution
          ? await substituteInStringAsync(v, vars ?? {}, resolver, authResolver)
          : substituteInString(v, vars ?? {}, resolver);
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
      ? await substituteInObjectAsync(
          effectiveBody,
          vars ?? {},
          resolver,
          authResolver,
        )
      : vars !== undefined
        ? (substituteInObject(
            effectiveBody,
            vars,
            resolver,
          ) as typeof block.request.body)
        : effectiveBody;
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  const requestHeaderType = getRequestHeaderType(headers);
  const isGraphQL = block.request.method === "GRAPHQL";
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
  const formDataBody =
    requestHeaderType === "form-data"
      ? getFormRequestBody(body, "form-data")
      : undefined;

  let multipartBody: FormData | undefined;
  if (formDataBody && typeof formDataBody === "object") {
    const baseDir = filePath
      ? (await import("path")).dirname(filePath)
      : process.cwd();
    multipartBody = await buildMultipartBody(
      formDataBody as Record<string, unknown>,
      baseDir,
    );
    headers = Object.fromEntries(
      Object.entries(headers).filter(
        ([k]) => k.toLowerCase() !== "content-type",
      ),
    );
  }

  const method = (isGraphQL ? "POST" : block.request.method) || "GET";
  const requestHeaders: Record<string, string> = isGraphQL
    ? { ...headers, "Content-Type": "application/json" }
    : headers;

  const response: RunnerResponseLike | undefined = undefined;

  await runScripts(
    block.scripts.preRequest,
    "preRequest",
    block,
    filePath,
    response,
  );

  try {
    let bodyPayload: string | Buffer | FormData | undefined;
    if (multipartBody) {
      bodyPayload = multipartBody;
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
      bodyPayload = new URLSearchParams(
        form as Record<string, string>,
      ).toString();
    } else if (typeof body === "string" && body.length > 0) {
      bodyPayload = body;
    }

    const res = await nodeHttpRequest({
      url,
      method,
      headers: requestHeaders,
      body: bodyPayload,
      httpVersion: block.request.httpVersion,
    });

    const rawBody = res.body;
    const rawBodyStr =
      typeof rawBody === "string" ? rawBody : String(rawBody ?? "");
    const contentType = res.headers["content-type"] || "";
    const isJson = contentType.includes("application/json");
    const responseBody = isJson
      ? {
          type: "json" as const,
          content: JSON.parse(rawBodyStr) as Record<string, unknown>,
        }
      : {
          type: "text" as const,
          content: rawBodyStr,
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
    );

    incrementReplayCount(stableDocIdForReplay ?? filePath ?? "", block.name);

    return {
      success: true,
      status: res.statusCode,
      headers: res.headers,
      url: res.url,
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
    } as KulalaRequestSuccessResponse;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } as KulalaRequestErrorResponse;
  }
}
