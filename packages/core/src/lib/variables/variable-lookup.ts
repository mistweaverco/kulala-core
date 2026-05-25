import { flattenToDotPaths } from "./flatten-json";
import {
  evaluateJsonPath,
  formatJsonPathResults,
  splitVariableExpression,
} from "./jsonpath";

/**
 * Parse a value stored in the flat variable map (JSON object/array or plain string).
 * JetBrains HTTP Client returns structured values from get/set, not only strings.
 */
export function parseStoredVariable(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Coerce a variable value to a string for {{ name }} substitution.
 */
export function formatVariableForSubstitution(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeJsonPathSuffix(path: string): string {
  if (!path) return "";
  if (path.startsWith(".") || path.startsWith("[")) return path;
  return `.${path}`;
}

function* splitVariableRoots(
  key: string,
): Generator<{ root: string; path: string }> {
  let bracketDepth = 0;
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (ch === "[") bracketDepth++;
    if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (ch === "." && bracketDepth === 0) {
      yield { root: key.slice(0, i), path: key.slice(i + 1) };
    }
  }
}

function resolveFromStoredRoot(
  flat: Record<string, string>,
  root: string,
  path: string,
): string | undefined {
  if (flat[root] === undefined) return undefined;
  const parsed = parseStoredVariable(flat[root]);
  if (!path) return formatVariableForSubstitution(parsed);
  const values = evaluateJsonPath(parsed, normalizeJsonPathSuffix(path));
  return formatJsonPathResults(values);
}

/**
 * Read a nested field from a stored variable value using a JetBrains-style path.
 */
export function getByVariablePath(obj: unknown, path: string): unknown {
  const values = evaluateJsonPath(obj, normalizeJsonPathSuffix(path));
  if (values.length === 0) return undefined;
  return values[0];
}

/**
 * Split a JetBrains-style variable path into segments (dots and .['key'] brackets).
 * @deprecated Prefer jsonpath.parseJsonPathSegments for new code.
 */
export function parseVariablePath(path: string): string[] {
  const segments: string[] = [];
  let rest = path;
  while (rest.length > 0) {
    if (rest.startsWith("['")) {
      const end = rest.indexOf("']");
      if (end === -1) break;
      segments.push(rest.slice(2, end));
      rest = rest.slice(end + 3);
      if (rest.startsWith(".")) rest = rest.slice(1);
      continue;
    }
    const dot = rest.indexOf(".");
    if (dot === -1) {
      if (rest.length > 0) segments.push(rest);
      break;
    }
    segments.push(rest.slice(0, dot));
    rest = rest.slice(dot + 1);
  }
  return segments;
}

/**
 * Resolve {{ key }} against a flat variable map (JetBrains JSONPath expressions).
 */
export function resolveVariableReference(
  key: string,
  flat: Record<string, string>,
): string | undefined {
  if (flat[key] !== undefined) return flat[key];

  const { root, path } = splitVariableExpression(key);
  if (path && flat[root] !== undefined) {
    const resolved = resolveFromStoredRoot(flat, root, path);
    if (resolved !== undefined) return resolved;
  }

  const splits = [...splitVariableRoots(key)].sort(
    (a, b) => b.root.length - a.root.length,
  );
  for (const { root: r, path: p } of splits) {
    if (!p) continue;
    const resolved = resolveFromStoredRoot(flat, r, p);
    if (resolved !== undefined) return resolved;
  }

  return undefined;
}

/**
 * Write a variable into the flat map for substitution and script get().
 * Objects/arrays are flattened to dotted paths; the root key keeps JSON for {{ name }}.
 */
export function writeVariableToMaps(
  name: string,
  value: unknown,
  flat: Record<string, string>,
): void {
  if (value !== null && typeof value === "object") {
    flattenToDotPaths(value, name, flat);
    flat[name] = formatVariableForSubstitution(value);
    return;
  }
  flat[name] = formatVariableForSubstitution(value);
}

/**
 * Remove a variable and any dotted-path keys derived from it.
 */
export function removeVariableFromMaps(
  name: string,
  flat: Record<string, string>,
): void {
  delete flat[name];
  const dotPrefix = `${name}.`;
  const bracketPrefix = `${name}.['`;
  for (const k of Object.keys(flat)) {
    if (k.startsWith(dotPrefix) || k.startsWith(bracketPrefix)) delete flat[k];
  }
}

/**
 * Merge persistence/env values into the flat substitution map (with nested path expansion).
 */
export function mergeVariableIntoFlat(
  name: string,
  value: unknown,
  flat: Record<string, string>,
): void {
  writeVariableToMaps(name, value, flat);
}
