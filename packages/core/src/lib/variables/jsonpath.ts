/**
 * JetBrains HTTP Client variable JSONPath (2024.2+).
 * @see https://www.jetbrains.com/help/idea/http-client-variables.html
 *
 * Supports dot paths, bracket keys (.['host.url']), indices ([0]), and wildcards ([*]).
 */

export type VariableExpressionParts = {
  root: string;
  /** Path after root (may start with . or [). Empty when the key is only the root name. */
  path: string;
};

/**
 * Split {{ expression }} into a stored variable root and a JSONPath suffix.
 * Bracket segments ([*], [0], .['key']) start the path; otherwise the first `.` splits.
 */
export function splitVariableExpression(key: string): VariableExpressionParts {
  const bracketStart = key.indexOf("[");
  if (bracketStart !== -1) {
    return { root: key.slice(0, bracketStart), path: key.slice(bracketStart) };
  }
  const dot = key.indexOf(".");
  if (dot !== -1) {
    return { root: key.slice(0, dot), path: key.slice(dot) };
  }
  return { root: key, path: "" };
}

/** True when the expression uses a wildcard array slice (triggers collection iteration). */
export function expressionHasWildcard(path: string): boolean {
  return /\[\s*\*\s*\]/.test(path);
}

type PathSegment =
  | { type: "property"; name: string }
  | { type: "index"; index: number }
  | { type: "wildcard" };

/**
 * Parse a JSONPath suffix (leading . or [ segments only).
 */
export function parseJsonPathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let rest = path;
  if (rest.startsWith(".")) rest = rest.slice(1);

  while (rest.length > 0) {
    if (rest.startsWith(".")) rest = rest.slice(1);
    if (rest.startsWith("['")) {
      const end = rest.indexOf("']");
      if (end === -1) break;
      segments.push({ type: "property", name: rest.slice(2, end) });
      rest = rest.slice(end + 3);
      if (rest.startsWith(".")) rest = rest.slice(1);
      continue;
    }
    if (rest.startsWith("[")) {
      const wildcard = rest.match(/^\[\s*\*\s*\]/);
      if (wildcard) {
        segments.push({ type: "wildcard" });
        rest = rest.slice(wildcard[0].length);
        if (rest.startsWith(".")) rest = rest.slice(1);
        continue;
      }
      const indexMatch = rest.match(/^\[\s*(\d+)\s*\]/);
      if (indexMatch) {
        segments.push({ type: "index", index: Number(indexMatch[1]) });
        rest = rest.slice(indexMatch[0].length);
        if (rest.startsWith(".")) rest = rest.slice(1);
        continue;
      }
      break;
    }
    const dot = rest.indexOf(".");
    const bracket = rest.indexOf("[");
    let end = rest.length;
    if (dot !== -1 && (bracket === -1 || dot < bracket)) end = dot;
    else if (bracket !== -1) end = bracket;
    const name = rest.slice(0, end);
    if (name.length > 0) segments.push({ type: "property", name });
    rest = rest.slice(end);
    if (rest.startsWith(".")) rest = rest.slice(1);
  }

  return segments;
}

function applySegment(values: unknown[], segment: PathSegment): unknown[] {
  if (values.length === 0) return [];

  if (segment.type === "wildcard") {
    const next: unknown[] = [];
    for (const v of values) {
      if (Array.isArray(v)) next.push(...v);
    }
    return next;
  }

  if (segment.type === "index") {
    const next: unknown[] = [];
    for (const v of values) {
      if (Array.isArray(v) && segment.index >= 0 && segment.index < v.length) {
        next.push(v[segment.index]);
      }
    }
    return next;
  }

  const next: unknown[] = [];
  for (const v of values) {
    if (v == null || typeof v !== "object") continue;
    if (Array.isArray(v)) continue;
    const field = (v as Record<string, unknown>)[segment.name];
    if (field !== undefined) next.push(field);
  }
  return next;
}

/**
 * Evaluate a JetBrains JSONPath suffix; returns all matched values (empty if none).
 */
export function evaluateJsonPath(data: unknown, path: string): unknown[] {
  if (!path) return [data];
  const segments = parseJsonPathSegments(path);
  if (segments.length === 0) return [data];

  let values: unknown[] = [data];
  for (const segment of segments) {
    values = applySegment(values, segment);
    if (values.length === 0) return [];
  }
  return values;
}

/**
 * Coerce JSONPath match list to a string for {{ }} substitution (single-value).
 */
export function formatJsonPathResults(values: unknown[]): string | undefined {
  if (values.length === 0) return undefined;
  const v = values[0];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
