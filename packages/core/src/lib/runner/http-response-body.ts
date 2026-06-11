import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";

import { formatWithBundledPrettier } from "../parser/prettier-bundled";
import type { KulalaRequestSuccessResponse } from "./types";

/** Client preferences for pretty-printing HTTP response bodies. */
export type KulalaResponseFormatOptions = {
  /** Indent width in spaces when `expand_tabs` is true; tab stop width when using tabs. Default 2. */
  indent?: number;
  /** When true (default), indent with spaces. When false, use tab characters. */
  expand_tabs?: boolean;
  /** Sort object keys when formatting JSON. Default false. */
  sort_keys?: boolean;
};

export const DEFAULT_RESPONSE_FORMAT: Required<KulalaResponseFormatOptions> = {
  indent: 2,
  expand_tabs: true,
  sort_keys: false,
};

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

function isJsonMediaType(mediaType: string): boolean {
  if (!mediaType) return false;
  return mediaType.includes("json") || mediaType.endsWith("+json");
}

export function resolveResponseFormatOptions(
  opts?: KulalaResponseFormatOptions,
): Required<KulalaResponseFormatOptions> {
  return {
    indent: opts?.indent ?? DEFAULT_RESPONSE_FORMAT.indent,
    expand_tabs: opts?.expand_tabs ?? DEFAULT_RESPONSE_FORMAT.expand_tabs,
    sort_keys: opts?.sort_keys ?? DEFAULT_RESPONSE_FORMAT.sort_keys,
  };
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortJsonKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Pretty-print a JSON value with indentation and optional key sorting. */
export function formatJsonValue(
  value: unknown,
  opts?: KulalaResponseFormatOptions,
): string {
  const resolved = resolveResponseFormatOptions(opts);
  let data = value;
  if (resolved.sort_keys) data = sortJsonKeys(data);

  if (!resolved.expand_tabs) {
    return JSON.stringify(data, null, "\t");
  }

  const space = resolved.indent > 0 ? resolved.indent : undefined;
  return JSON.stringify(data, null, space);
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  processEntities: true,
});

function xmlIndentBy(opts: Required<KulalaResponseFormatOptions>): string {
  return opts.expand_tabs ? " ".repeat(opts.indent) : "\t";
}

function createXmlBuilder(
  opts: Required<KulalaResponseFormatOptions>,
): XMLBuilder {
  return new XMLBuilder({
    ignoreAttributes: false,
    preserveOrder: true,
    format: true,
    indentBy: xmlIndentBy(opts),
  });
}

/** Pretty-print XML; returns the original string when parsing or validation fails. */
export function formatXmlBody(
  rawBodyStr: string,
  opts?: KulalaResponseFormatOptions,
): string {
  const trimmed = rawBodyStr.trim();
  if (!trimmed) return rawBodyStr;

  if (XMLValidator.validate(trimmed) !== true) return rawBodyStr;

  const resolved = resolveResponseFormatOptions(opts);
  const xmlBuilder = createXmlBuilder(resolved);

  try {
    const built = xmlBuilder.build(xmlParser.parse(trimmed));
    if (typeof built !== "string" || !built) return rawBodyStr;
    return built.startsWith("\n") ? built.slice(1) : built;
  } catch {
    return rawBodyStr;
  }
}

function prettierOptions(opts: Required<KulalaResponseFormatOptions>) {
  return {
    tabWidth: opts.indent,
    printWidth: 80,
    useTabs: !opts.expand_tabs,
  };
}

type ResponsePrettierParser = "html" | "babel" | "graphql";

function prettierParserForMediaType(
  mediaType: string,
): ResponsePrettierParser | null {
  if (mediaType === "text/html" || mediaType === "application/xhtml+xml") {
    return "html";
  }
  if (
    mediaType === "application/javascript" ||
    mediaType === "text/javascript" ||
    mediaType === "application/ecmascript" ||
    mediaType === "text/ecmascript"
  ) {
    return "babel";
  }
  if (mediaType === "application/graphql") {
    return "graphql";
  }
  return null;
}

async function formatWithPrettierMediaType(
  rawBodyStr: string,
  mediaType: string,
  opts: Required<KulalaResponseFormatOptions>,
): Promise<string> {
  const parser = prettierParserForMediaType(mediaType);
  if (!parser) return rawBodyStr;
  const trimmed = rawBodyStr.trim();
  if (!trimmed) return rawBodyStr;
  try {
    return await formatWithBundledPrettier(
      trimmed,
      parser,
      prettierOptions(opts),
    );
  } catch {
    return rawBodyStr;
  }
}

/** Display text for a runner response body (formatted when available). */
export function responseBodyDisplayText(
  body: KulalaRequestSuccessResponse["body"],
): string {
  if (body.type === "json") {
    return body.formatted ?? formatJsonValue(body.content);
  }
  return body.content;
}

/** Map raw HTTP body + Content-Type to the JSON wrapper used in runner responses. */
export async function buildRunnerResponseBody(
  rawBodyStr: string,
  contentType: string,
  formatOpts?: KulalaResponseFormatOptions,
): Promise<KulalaRequestSuccessResponse["body"]> {
  const opts = resolveResponseFormatOptions(formatOpts);
  const mediaType = primaryMediaType(contentType);

  if (isJsonMediaType(mediaType)) {
    try {
      const jsonBody = JSON.parse(rawBodyStr) as Record<string, unknown>;
      return {
        type: "json" as const,
        content: jsonBody,
        formatted: formatJsonValue(jsonBody, opts),
      };
    } catch {
      // treat as text below
    }
  }

  let content = rawBodyStr;
  if (mediaType && isXmlMediaType(mediaType)) {
    content = formatXmlBody(rawBodyStr, opts);
  } else if (mediaType) {
    content = await formatWithPrettierMediaType(rawBodyStr, mediaType, opts);
  }

  return mediaType
    ? { type: "text" as const, content, mediaType }
    : { type: "text" as const, content };
}
