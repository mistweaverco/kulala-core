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
 * Get a value from an object by dot path (e.g. "json.token" from { json: { token: "x" } }).
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

/**
 * Resolve a request variable key against previous run results.
 * Key forms: REQUEST_NAME.response.body.$.json.path, REQUEST_NAME.response.headers.HeaderName, REQUEST_NAME.response.headers['Header Name'].
 * Returns string value or undefined if not found / not a request var.
 */
export function resolveRequestVariable(
  key: string,
  previousResults: Map<string, PreviousResponse>,
): string | undefined {
  const trimmed = key.trim();
  const parts = trimmed.split(".");
  if (parts.length < 4) return undefined;
  const [blockName, reqOrRes, bodyOrHeaders, ...rest] = parts;
  if (!blockName || !reqOrRes || !bodyOrHeaders) return undefined;
  const result = previousResults.get(blockName);
  if (!result) return undefined;
  if (reqOrRes !== "response") return undefined; // only response supported for now
  if (bodyOrHeaders === "body") {
    const pathPart = rest.join(".");
    const body = result.body;
    let content: unknown;
    if (body.type === "json") content = body.content;
    else content = body.content;
    const value = pathPart.startsWith("$")
      ? getByPath(content, pathPart)
      : getByPath(content, "$." + pathPart);
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    return JSON.stringify(value);
  }
  if (bodyOrHeaders === "headers") {
    const headerKey = rest.join(".");
    const normalized = headerKey.replace(/^['"]|['"]$/g, "");
    const headers = result.headers;
    if (headers[headerKey] !== undefined) return headers[headerKey];
    if (headers[normalized] !== undefined) return headers[normalized];
    const lower = normalized.toLowerCase();
    const found = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === lower,
    );
    return found ? found[1] : undefined;
  }
  return undefined;
}

/**
 * Check if a variable key looks like a request variable reference.
 */
export function isRequestVariableKey(key: string): boolean {
  const t = key.trim();
  return t.includes(".response.") || t.includes(".request.");
}
