import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaRequest } from "../parser/types/request";
import type { KulalaStdinActionRunLimit } from "../parser/types/stdinparsed";
import {
  writeRequestResponseToStderr,
  writeRequestResponseToStdout,
} from "../parser/lib/helpers";

const setUserAgentHeaderIfNotPresent = (
  headers: KulalaRequest["headers"],
): KulalaRequest["headers"] => {
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    return {
      ...headers,
      "User-Agent": [
        {
          name: "User-Agent",
          value: "kulala-core/0.1.0",
        },
      ],
    };
  }
  return headers;
};

type KulalaRequestSuccessResponse = {
  success: true;
  status: number;
  headers: Record<string, string>;
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

const doRequestFromBlock = async (
  block: KulalaBlock,
): Promise<KulalaRequestSuccessResponse | KulalaRequestErrorResponse> => {
  block.request.headers = setUserAgentHeaderIfNotPresent(block.request.headers);
  const headers = {} as Record<string, string>;
  for (const [key, value] of Object.entries(block.request.headers)) {
    if (!headers[key]) {
      headers[key] = value.map((h) => h.value).join("; ");
    }
  }

  try {
    const response = await fetch(block.request.url, {
      method: block.request.method,
      headers,
      body: block.request.body
        ? typeof block.request.body === "object"
          ? JSON.stringify(block.request.body)
          : block.request.body
        : undefined,
    });
    const text = await response.text();
    const contentType = response.headers.get("Content-Type") || "";
    const isJson = contentType.includes("application/json");
    const body = isJson
      ? {
          type: "json",
          content: JSON.parse(text || "") as Record<string, unknown>,
        }
      : { type: "text", content: text || "" };
    const headersObj: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headersObj[key] = value;
    });

    return {
      status: response.status,
      headers: headersObj,
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
    results.push(await doRequestFromBlock(block));
  }
  writeRequestResponseToStdout(results);
};

export const KulalaRunner = () => {
  return {
    run,
  };
};
