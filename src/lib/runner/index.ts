import got, { type Method, type Response } from "got";
import type { FormDataLike } from "form-data-encoder";
import { version } from "./../../../package.json";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaRequest } from "../parser/types/request";
import type { KulalaStdinActionRunLimit } from "../parser/types/stdinparsed";
import {
  writeRequestResponseToStderr,
  writeRequestResponseToStdout,
} from "../parser/lib/helpers";
import { incrementReplayCount } from "../persistence";
import {
  getStableDocumentId,
  resolveVariables,
  substituteInString,
  substituteInObject,
} from "../variables";
import {
  resolveRequestVariable,
  type PreviousResponse,
} from "../variables/request-vars";
import { runScripts } from "./scripts";

const buildHeadersFromSection = (
  headerSection: KulalaRequest["headerSection"],
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const entry of headerSection) {
    if (entry.type === "header") {
      const v = entry.value ?? "";
      if (!out[entry.name]) out[entry.name] = v;
      else out[entry.name] = out[entry.name] + "; " + v;
    }
  }
  return out;
};

const setUserAgentHeaderIfNotPresent = (
  headers: Record<string, string>,
): Record<string, string> => {
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    return {
      ...headers,
      "User-Agent": "kulala-core/" + version,
    };
  }
  return headers;
};

type KulalaRequestSuccessResponse = {
  success: true;
  status: number;
  headers: Record<string, string>;
  timings: {
    namelookup: number;
    connect: number;
    appconnect: number;
    pretransfer: number;
    redirect: number;
    starttransfer: number;
  };
  body:
    | {
        type: "text";
        content: string;
      }
    | {
        type: "json";
        content: Record<string, unknown>;
      };
};

type KulalaRequestErrorResponse = {
  success: false;
  error: string;
};

type RequestHeaderType = "json" | "form-data" | "form-urlencoded" | "invalid";

const getRequestHeaderType = (headers: unknown): RequestHeaderType => {
  if (typeof headers !== "object" || headers === null) {
    return "invalid";
  }
  const contentTypeHeader = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "content-type",
  );
  if (!contentTypeHeader) {
    return "invalid";
  }
  const contentTypeValue = contentTypeHeader[1];
  if (typeof contentTypeValue === "string") {
    if (contentTypeValue.includes("application/json")) {
      return "json";
    }
    if (contentTypeValue.includes("multipart/form-data")) {
      return "form-data";
    }
    if (contentTypeValue.includes("application/x-www-form-urlencoded")) {
      return "form-urlencoded";
    }
  }
  return "invalid";
};

const getJSONRequestBody = (
  body: unknown,
): Record<string, unknown> | undefined => {
  if (typeof body === "object" && body !== null) {
    return body as Record<string, unknown>;
  }
  return undefined;
};

const getGraphQLRequestBody = (
  body: unknown,
): { query: string; variables?: Record<string, unknown> } | undefined => {
  if (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query: unknown }).query === "string"
  ) {
    const graphqlBody = body as {
      query: string;
      variables?: Record<string, unknown>;
    };
    return {
      query: graphqlBody.query,
      variables: graphqlBody.variables,
    };
  }
  return undefined;
};

/** Parse "key=value&key2=value2" into an object (application/x-www-form-urlencoded). */
const parseFormUrlEncoded = (body: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      out[decodeURIComponent(pair.trim())] = "";
    } else {
      out[decodeURIComponent(pair.slice(0, eq).trim())] = decodeURIComponent(
        pair
          .slice(eq + 1)
          .trim()
          .replace(/\+/g, " "),
      );
    }
  }
  return out;
};

const getFormRequestBody = (
  body: unknown,
  formType: "form-data" | "form-urlencoded",
): Record<string, unknown> | undefined => {
  if (formType === "form-urlencoded") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  if (formType === "form-data") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  return undefined;
};

/** True if value looks like a file reference: { filePath: string, filename?: string }. */
const isFileRef = (
  value: unknown,
): value is { filePath: string; filename?: string } =>
  typeof value === "object" &&
  value !== null &&
  "filePath" in value &&
  typeof (value as { filePath: unknown }).filePath === "string";

/**
 * Build FormData for multipart/form-data. Body entries can be strings or
 * file refs { filePath, filename? }. Paths are resolved relative to baseDir.
 */
const buildMultipartBody = async (
  body: Record<string, unknown>,
  baseDir: string,
): Promise<FormData> => {
  const path = await import("path");
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (isFileRef(value)) {
      const resolvedPath = path.resolve(baseDir, value.filePath);
      const file = Bun.file(resolvedPath);
      form.append(
        key,
        file,
        value.filename ?? value.filePath.split(/[/\\]/).pop(),
      );
    } else {
      form.append(key, String(value ?? ""));
    }
  }
  return form;
};

type VariableResolver = (name: string) => string | undefined;

const doRequestFromBlock = async (
  block: KulalaBlock,
  filePath?: string,
  vars?: Record<string, string>,
  stableDocIdForReplay?: string,
  resolver?: VariableResolver,
): Promise<KulalaRequestSuccessResponse | KulalaRequestErrorResponse> => {
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

  let response: Response | undefined = undefined;

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
      method: (isGraphQL ? "POST" : block.request.method) as Method,
      headers: isGraphQL
        ? {
            ...headers,
            "Content-Type": "application/json",
          }
        : headers,
    };

    if (multipartBody) {
      response = await got(url, {
        ...baseOptions,
        body: multipartBody as unknown as FormDataLike,
      });
    } else if (graphqlBody !== undefined) {
      response = await got(url, {
        ...baseOptions,
        json: graphqlBody,
      });
    } else if (json !== undefined) {
      response = await got(url, {
        ...baseOptions,
        json,
      });
    } else if (form !== undefined) {
      response = await got(url, {
        ...baseOptions,
        form: form as Record<string, string>,
      });
    } else {
      response = await got(url, baseOptions);
    }
    const rawBody = response.body;
    const contentType = response.headers["content-type"] || "";
    const isJson = contentType.includes("application/json");
    const body = isJson
      ? {
          type: "json",
          content: (typeof rawBody === "object" && rawBody !== null
            ? rawBody
            : JSON.parse(
                typeof rawBody === "string" ? rawBody : String(rawBody ?? ""),
              )) as Record<string, unknown>,
        }
      : {
          type: "text",
          content:
            typeof rawBody === "string" ? rawBody : String(rawBody ?? ""),
        };

    const { phases } = response.timings;

    await runScripts(
      block.scripts.postRequest,
      "postRequest",
      block,
      filePath,
      response,
    );

    incrementReplayCount(stableDocIdForReplay ?? filePath ?? "", block.name);

    return {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
      timings: {
        namelookup: phases.dns,
        connect: phases.tcp,
        appconnect: phases.tls,
        pretransfer: phases.request,
        redirect:
          phases.total && phases.firstByte
            ? phases.total - phases.firstByte
            : 0,
        starttransfer: phases.firstByte,
      },
      body,
    } as KulalaRequestSuccessResponse;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    } as KulalaRequestErrorResponse;
  }
};

const findBlockAtCursor = (
  doc: KulalaDocument,
  cursorPosition: { line: number; column: number },
): KulalaBlock | null => {
  for (const block of doc.blocks) {
    if (
      block.position.start <= cursorPosition.line &&
      block.position.end >= cursorPosition.line
    ) {
      return block;
    }
  }
  return null;
};

export type KulalaRunOptions = {
  /** Raw document content (for stable ID when filepath is absent). */
  content?: string;
  /** Environment name for variable resolution (kuba, etc.). Defaults to "default". */
  env?: string;
};

const run = async (
  doc: KulalaDocument,
  limit?: KulalaStdinActionRunLimit[],
  options?: KulalaRunOptions,
): Promise<void> => {
  const blocks: KulalaBlock[] = [];
  if (limit) {
    for (const l of limit) {
      if (l.filter === "cursorPosition") {
        const block = findBlockAtCursor(doc, {
          line: l.line,
          column: l.column,
        });
        if (!block) {
          writeRequestResponseToStderr({
            success: false,
            error: "No block found at the cursor position.",
          } as KulalaRequestErrorResponse);
          return;
        } else {
          blocks.push(block);
        }
      }
      if (l.filter === "name") {
        const block = doc.blocks.find((b) => b.name === l.name);
        if (block) blocks.push(block);
      }
    }
  } else {
    blocks.push(...doc.blocks);
  }

  const env = options?.env ?? "default";
  const stableDocId = getStableDocumentId(doc.filepath, options?.content);
  const path = await import("path");
  const startDir = doc.filepath ? path.dirname(doc.filepath) : process.cwd();

  const results: (KulalaRequestSuccessResponse | KulalaRequestErrorResponse)[] =
    [];
  const previousResults = new Map<string, PreviousResponse>();
  for (const block of blocks) {
    const vars = await resolveVariables(env, stableDocId, block.name, startDir);
    const resolver = (key: string) =>
      resolveRequestVariable(key, previousResults);
    const result = await doRequestFromBlock(
      block,
      doc.filepath,
      vars,
      stableDocId,
      resolver,
    );
    results.push(result);
    if (result.success) {
      previousResults.set(block.name, {
        body: result.body,
        headers: result.headers,
      });
    }
  }
  writeRequestResponseToStdout(results);
};

export const KulalaRunner = () => {
  return {
    run,
  };
};
