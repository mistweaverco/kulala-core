import got, { type Method, type Response } from "got";
import type { FormDataLike } from "form-data-encoder";
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
  const bodyStr = JSON.stringify(block.request.body ?? {});
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
          block.request.body,
          vars ?? {},
          resolver,
          authResolver,
        )
      : vars !== undefined
        ? (substituteInObject(
            block.request.body,
            vars,
            resolver,
          ) as typeof block.request.body)
        : block.request.body;
  } catch (error) {
    if (error instanceof OAuth2PromptError) {
      return error.promptResponse;
    }
    throw error;
  }

  const requestHeaderType = getRequestHeaderType(headers);
  const isGraphQL = block.request.method === "GRAPHQL";
  const graphqlBody = isGraphQL ? getGraphQLRequestBody(body) : undefined;
  const json =
    !isGraphQL && requestHeaderType === "json"
      ? getJSONRequestBody(body)
      : undefined;
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
    const baseOptions = {
      retry: { limit: 0 },
      method: method as Method,
      headers: requestHeaders,
    };

    let res: Response;
    if (multipartBody) {
      res = await got(url, {
        ...baseOptions,
        body: multipartBody as unknown as FormDataLike,
      });
    } else if (graphqlBody !== undefined) {
      // Send plain { query, variables } per GraphQL over HTTP; never wrap or pre-stringify.
      const payload: { query: string; variables?: Record<string, unknown> } = {
        query: typeof graphqlBody.query === "string" ? graphqlBody.query : "",
        ...(graphqlBody.variables != null
          ? { variables: graphqlBody.variables }
          : {}),
      };
      res = await got(url, { ...baseOptions, json: payload });
    } else if (json !== undefined) {
      res = await got(url, { ...baseOptions, json });
    } else if (form !== undefined) {
      res = await got(url, {
        ...baseOptions,
        form: form as Record<string, string>,
      });
    } else {
      res = await got(url, baseOptions);
    }

    const rawBody = res.body;
    const contentType = res.headers["content-type"] || "";
    const isJson = contentType.includes("application/json");
    const responseBody = isJson
      ? {
          type: "json" as const,
          content: (typeof rawBody === "object" && rawBody !== null
            ? rawBody
            : JSON.parse(
                typeof rawBody === "string" ? rawBody : String(rawBody ?? ""),
              )) as Record<string, unknown>,
        }
      : {
          type: "text" as const,
          content:
            typeof rawBody === "string" ? rawBody : String(rawBody ?? ""),
        };

    const responseLike: RunnerResponseLike = {
      body: rawBody,
      statusCode: res.statusCode,
      headers: res.headers as Record<string, string>,
      timings: res.timings,
    };

    await runScripts(
      block.scripts.postRequest,
      "postRequest",
      block,
      filePath,
      responseLike,
    );

    incrementReplayCount(stableDocIdForReplay ?? filePath ?? "", block.name);

    const { phases } = res.timings;
    const total = phases.total ?? 0;
    const firstByte = phases.firstByte ?? 0;
    return {
      success: true,
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
      timings: {
        dns: phases.dns ?? 0,
        tcp: phases.tcp ?? 0,
        tls: phases.tls ?? 0,
        request: phases.request ?? 0,
        redirect: total && firstByte ? total - firstByte : 0,
        firstByte,
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
