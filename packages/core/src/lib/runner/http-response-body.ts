import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

import type { KulalaRequestSuccessResponse } from "./types";

/** Primary MIME type without parameters (e.g. `application/xml` from `application/xml;charset=UTF-8`). */
export function primaryMediaType(contentType: string): string {
  const primary = contentType.split(";")[0]?.trim();
  return primary ? primary.toLowerCase() : "";
}

/** Whether the primary MIME type should be treated as XML for response formatting. */
export function isXmlMediaType(mediaType: string): boolean {
  if (!mediaType) return false;
  return (
    mediaType === "application/xml" ||
    mediaType === "text/xml" ||
    mediaType.endsWith("+xml")
  );
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  processEntities: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  preserveOrder: true,
  format: true,
  indentBy: "  ",
});

/** Pretty-print XML; returns the original string when parsing or validation fails. */
export function formatXmlBody(rawBodyStr: string): string {
  const trimmed = rawBodyStr.trim();
  if (!trimmed) return rawBodyStr;

  if (XMLValidator.validate(trimmed) !== true) return rawBodyStr;

  try {
    const built = xmlBuilder.build(xmlParser.parse(trimmed));
    if (typeof built !== "string" || !built) return rawBodyStr;
    return built.startsWith("\n") ? built.slice(1) : built;
  } catch {
    return rawBodyStr;
  }
}

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
  if (jsonBody !== null) {
    return { type: "json" as const, content: jsonBody };
  }

  const mediaType = primaryMediaType(contentType);
  let content = rawBodyStr;
  if (mediaType && isXmlMediaType(mediaType)) {
    content = formatXmlBody(content);
  }

  return mediaType
    ? { type: "text" as const, content, mediaType }
    : { type: "text" as const, content };
}
