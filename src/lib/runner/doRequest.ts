import got, { type Method, type Response } from "got";
import type { FormDataLike } from "form-data-encoder";
import type { KulalaBlock } from "../parser/types/block";
import { substituteInString, substituteInObject } from "../variables";
import { incrementReplayCount } from "../persistence";
import { runScripts } from "./scripts";
import {
  buildHeadersFromSection,
  normalizeAuthorizationHeader,
  setUserAgentHeaderIfNotPresent,
} from "./headers";
import {
  getRequestHeaderType,
  getJSONRequestBody,
  getGraphQLRequestBody,
  getFormRequestBody,
  buildMultipartBody,
} from "./body";
import type {
  KulalaRequestSuccessResponse,
  KulalaRequestErrorResponse,
  VariableResolver,
  RunnerResponseLike,
} from "./types";

export type { RunnerResponseLike } from "./types";

export async function doRequestFromBlock(
  block: KulalaBlock,
  filePath: string | undefined,
  vars: Record<string, string> | undefined,
  stableDocIdForReplay: string | undefined,
  resolver: VariableResolver | undefined,
): Promise<KulalaRequestSuccessResponse | KulalaRequestErrorResponse> {
  const url =
    vars !== undefined
      ? substituteInString(block.request.url, vars, resolver)
      : block.request.url;

  let headers = setUserAgentHeaderIfNotPresent(
    buildHeadersFromSection(block.request.headerSection),
  );
  if (vars !== undefined) {
    const substitutedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      substitutedHeaders[k] = substituteInString(v, vars, resolver);
    }
    headers = substitutedHeaders;
  }
  headers = normalizeAuthorizationHeader(headers);

  const body =
    vars !== undefined
      ? (substituteInObject(
          block.request.body,
          vars,
          resolver,
        ) as typeof block.request.body)
      : block.request.body;

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
        namelookup: phases.dns ?? 0,
        connect: phases.tcp ?? 0,
        appconnect: phases.tls ?? 0,
        pretransfer: phases.request ?? 0,
        redirect: total && firstByte ? total - firstByte : 0,
        starttransfer: firstByte,
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
