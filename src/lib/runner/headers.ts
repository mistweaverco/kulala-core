import type { KulalaRequest } from "../parser/types/request";
import { version } from "./../../../package.json";

export function buildHeadersFromSection(
  headerSection: KulalaRequest["headerSection"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of headerSection) {
    if (entry.type === "header") {
      const v = entry.value ?? "";
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
