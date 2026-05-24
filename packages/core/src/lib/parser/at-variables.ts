/**
 * JetBrains HTTP Client in-file variables: @name = value (or @name=value).
 * See https://www.jetbrains.com/help/idea/http-client-variables.html
 */

import { isRequestLine } from "./request";
import { isPreRequestScriptLine } from "./script";

const AT_VAR_LINE = /^@([A-Za-z0-9_.-]+)\s*=\s*(.*)$/;

/**
 * Parse a single @variable = value line. Returns undefined if the line is not a definition.
 * Strips an optional trailing # comment from the value (JetBrains-style).
 */
export function parseAtVariableLine(
  line: string,
): { name: string; value: string } | undefined {
  const trimmed = line.trim();
  const m = trimmed.match(AT_VAR_LINE);
  if (!m) return undefined;
  let value = m[2]!.trim();
  const hashIdx = value.indexOf("#");
  if (hashIdx >= 0) {
    value = value.slice(0, hashIdx).trim();
  }
  return { name: m[1]!, value };
}

/**
 * Collect @ variables from lines before the first request or ### block marker.
 */
export function extractFileHeaderAtVariables(
  content: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (
      t.startsWith("###") ||
      isRequestLine(line) ||
      isPreRequestScriptLine(line)
    )
      break;
    if (!t || t.startsWith("#")) continue;
    const p = parseAtVariableLine(line);
    if (p) out[p.name] = p.value;
  }
  return out;
}
