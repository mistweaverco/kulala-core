/**
 * Request variable resolution: {{REQUEST_NAME.response.body.$.path}} and {{REQUEST_NAME.response.headers.HeaderName}}.
 * See https://neovim.getkulala.net/docs/usage/request-variables
 */

import { evaluateJsonPath, formatJsonPathResults } from "./jsonpath";

export type PreviousResponse = {
  body:
    | { type: "text"; content: string; mediaType?: string }
    | { type: "json"; content: Record<string, unknown> };
  headers: Record<string, string>;
};

/**
 * Resolve a JetBrains-style JSONPath on a response body (supports [n], [*], .['key'], etc.).
 */
function resolveBodyJsonPath(
  content: unknown,
  path: string,
): string | undefined {
  if (path === "" || path === "$") return formatResolvedValue(content);
  const suffix = path.replace(/^\$\.?/, "");
  if (suffix === "") return formatResolvedValue(content);
  const jsonPath =
    suffix.startsWith(".") || suffix.startsWith("[") ? suffix : `.${suffix}`;
  return formatJsonPathResults(evaluateJsonPath(content, jsonPath));
}

type ParsedRequestVarRef = {
  blockName: string;
  section: "response" | "request";
  part: "body" | "headers";
  path?: string;
  headerName?: string;
};

function parseRequestVariableKey(key: string): ParsedRequestVarRef | undefined {
  const trimmed = key.trim();
  const bodyMatch = trimmed.match(
    /^([^.]+)\.(response|request)\.body(?:\.(.+))?$/,
  );
  if (bodyMatch) {
    return {
      blockName: bodyMatch[1]!,
      section: bodyMatch[2] as "response" | "request",
      part: "body",
      path: bodyMatch[3],
    };
  }
  const headerBracketMatch = trimmed.match(
    /^([^.]+)\.(response|request)\.headers\[['"]([^'"]+)['"]\]$/,
  );
  if (headerBracketMatch) {
    return {
      blockName: headerBracketMatch[1]!,
      section: headerBracketMatch[2] as "response" | "request",
      part: "headers",
      headerName: headerBracketMatch[3],
    };
  }
  const headerDotMatch = trimmed.match(
    /^([^.]+)\.(response|request)\.headers\.(.+)$/,
  );
  if (headerDotMatch) {
    return {
      blockName: headerDotMatch[1]!,
      section: headerDotMatch[2] as "response" | "request",
      part: "headers",
      headerName: headerDotMatch[3],
    };
  }
  return undefined;
}

function formatResolvedValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

function resolveHeaderValue(
  headers: Record<string, string>,
  headerName: string,
): string | undefined {
  const normalized = headerName.replace(/^['"]|['"]$/g, "");
  if (headers[headerName] !== undefined) return headers[headerName];
  if (headers[normalized] !== undefined) return headers[normalized];
  const lower = normalized.toLowerCase();
  const found = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === lower,
  );
  return found ? found[1] : undefined;
}

/**
 * Resolve a request variable key against previous run results.
 * Key forms: REQUEST_NAME.response.body.$.path (JSON fields on the parsed body), REQUEST_NAME.response.headers.HeaderName, REQUEST_NAME.response.headers['Header Name'].
 * Returns string value or undefined if not found / not a request var.
 */
export function resolveRequestVariable(
  key: string,
  previousResults: Map<string, PreviousResponse>,
): string | undefined {
  const parsed = parseRequestVariableKey(key);
  if (!parsed) return undefined;
  const result = previousResults.get(parsed.blockName);
  if (!result) return undefined;
  if (parsed.section !== "response") return undefined;
  if (parsed.part === "body") {
    const pathPart = parsed.path ?? "";
    const body = result.body;
    const content =
      body.type === "json" ? body.content : (body.content as unknown);
    const jsonPath = pathPart
      ? pathPart.startsWith("$")
        ? pathPart
        : `$.${pathPart}`
      : "$";
    return resolveBodyJsonPath(content, jsonPath);
  }
  if (parsed.part === "headers" && parsed.headerName) {
    return resolveHeaderValue(result.headers, parsed.headerName);
  }
  return undefined;
}

/**
 * Check if a variable key looks like a request variable reference.
 */
export function isRequestVariableKey(key: string): boolean {
  return parseRequestVariableKey(key.trim()) !== undefined;
}
