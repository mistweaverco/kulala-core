import type { KulalaRequestSuccessResponse } from "./types";

/** Map raw HTTP body + Content-Type to the JSON wrapper used in runner responses. */
export function buildRunnerResponseBody(
  rawBodyStr: string,
  contentType: string,
): KulalaRequestSuccessResponse["body"] {
  let jsonBody: Record<string, unknown> | null = null;
  if (contentType.toLowerCase().includes("json")) {
    try {
      jsonBody = JSON.parse(rawBodyStr) as Record<string, unknown>;
    } catch {
      // treat as text
    }
  }
  return jsonBody !== null
    ? { type: "json" as const, content: jsonBody }
    : { type: "text" as const, content: rawBodyStr };
}
