import type { KulalaRequest } from "../parser/types/request";
import { version } from "./../../../version.json";

export function buildHeadersFromSection(
  headerSection: KulalaRequest["headerSection"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of headerSection) {
    if (entry.type === "header") {
      // Unescape braces if content came from JSON stdin (similar to header parser)
      // When content is JSON-encoded, braces may be escaped as \{ and \} or \\{ and \\}
      // We need to unescape them to get the actual {{variable}} syntax
      let v = entry.value ?? "";
      if (v) {
        // Handle both \{ and \\{ patterns (unescape multiple times to handle double-escaping)
        v = v.replace(/\\+{/g, "{").replace(/\\+}/g, "}");
      }
      if (!out[entry.name]) out[entry.name] = v;
      else out[entry.name] = out[entry.name] + "; " + v;
    }
  }
  return out;
}

export function setUserAgentHeaderIfNotPresent(
  headers: Record<string, string>,
): Record<string, string> {
  if (!headers["User-Agent"] && !headers["user-agent"]) {
    return {
      ...headers,
      "User-Agent": "kulala-core/" + version,
    };
  }
  return headers;
}

/**
 * Kulala-compatible Authorization header helpers.
 *
 * Currently supported:
 * - Basic: if value is "Basic username:password" (or "Basic username password"),
 *   encode credentials as base64 and replace value with "Basic <base64>".
 *
 * If the value is already base64 (no ":" and not two tokens), it's left unchanged.
 */
export function normalizeAuthorizationHeader(
  headers: Record<string, string>,
): Record<string, string> {
  const authKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === "authorization",
  );
  if (!authKey) return headers;
  const raw = headers[authKey];
  if (typeof raw !== "string") return headers;

  const trimmed = raw.trim();
  const match = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!match) return headers;

  const scheme = match[1] ?? "";
  const rest = (match[2] ?? "").trim();

  if (scheme.toLowerCase() !== "basic") return headers;

  let credentials: string | undefined;
  if (rest.includes(":")) {
    credentials = rest;
  } else {
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length === 2) {
      credentials = `${parts[0]}:${parts[1]}`;
    }
  }

  if (!credentials) return headers;

  const encoded = Buffer.from(credentials, "utf8").toString("base64");
  return { ...headers, [authKey]: `Basic ${encoded}` };
}
