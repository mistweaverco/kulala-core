import got, { type Method, type Response } from "got";
import { version } from "./../../../package.json";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaRequest } from "../parser/types/request";
import type { KulalaStdinActionRunLimit } from "../parser/types/stdinparsed";
import {
  writeRequestResponseToStderr,
  writeRequestResponseToStdout,
} from "../parser/lib/helpers";
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

const getFormRequestBody = (
  body: unknown,
  formType: "form-data" | "form-urlencoded",
): Record<string, unknown> | undefined => {
  if (formType === "form-data") {
    const formData: Record<string, string> = {};
    const pairs = (body as string).split("&");
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      formData[key] = value;
    }
    return formData;
  }
  if (formType === "form-urlencoded") {
    return getJSONRequestBody(body);
  }
  return undefined;
};

const doRequestFromBlock = async (
  block: KulalaBlock,
  filePath?: string,
): Promise<KulalaRequestSuccessResponse | KulalaRequestErrorResponse> => {
  const headers = setUserAgentHeaderIfNotPresent(
    buildHeadersFromSection(block.request.headerSection),
  );
  const requestHeaderType = getRequestHeaderType(headers);
  const json =
    requestHeaderType === "json"
      ? getJSONRequestBody(block.request.body)
      : undefined;
  const form =
    requestHeaderType === "form-urlencoded"
      ? getFormRequestBody(block.request.body, "form-urlencoded")
      : requestHeaderType === "form-data"
        ? getFormRequestBody(block.request.body, "form-data")
        : undefined;

  let response: Response | undefined = undefined;

  await runScripts(
    block.scripts.preRequest,
    "preRequest",
    block,
    filePath,
    response,
  );

  try {
    response = await got(block.request.url, {
      retry: {
        limit: 0,
      },
      method: block.request.method as Method,
      headers,
      json,
      form,
    });
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

const run = async (
  doc: KulalaDocument,
  limit?: KulalaStdinActionRunLimit[],
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
    }
  } else {
    blocks.push(...doc.blocks);
  }
  const results: (KulalaRequestSuccessResponse | KulalaRequestErrorResponse)[] =
    [];
  for (const block of blocks) {
    results.push(await doRequestFromBlock(block, doc.filepath));
  }
  writeRequestResponseToStdout(results);
};

export const KulalaRunner = () => {
  return {
    run,
  };
};
