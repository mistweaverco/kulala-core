/**
 * Request variable resolution: {{REQUEST_NAME.response.body.$.path}} and {{REQUEST_NAME.response.headers.HeaderName}}.
 * See https://neovim.getkulala.net/docs/usage/request-variables
 */

export type PreviousResponse = {
  body:
    | { type: "text"; content: string }
    | { type: "json"; content: Record<string, unknown> };
  headers: Record<string, string>;
};

/**
 * Get a value from an object by dot path (e.g. "token" from { token: "x" }).
 */
function getByPath(obj: unknown, path: string): unknown {
  if (path === "" || path === "$") return obj;
  const parts = path.replace(/^\$\.?/, "").split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
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
    const value = pathPart.startsWith("$")
      ? getByPath(content, pathPart)
      : getByPath(content, pathPart ? "$." + pathPart : "$");
    return formatResolvedValue(value);
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
