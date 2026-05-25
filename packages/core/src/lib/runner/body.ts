import {
  parseGraphQLContent,
  parseGraphQLVariablesJson,
} from "../parser/graphql-content";
import type { KulalaRequestBodyFromFileContent } from "../parser/types/body";
import type { RequestHeaderType } from "./types";

/**
 * Normalize CRLF and CR-only line endings to `\n`.
 * Without this, `split("\n")` sees one giant line and whole-line `//` comments are not stripped.
 */
export function normalizeHttpBodyNewlines(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Remove HTTP client whole-line `//` comments from raw body text.
 * (The block parser treats every line after the blank line as body, so `//` is not a parser comment.)
 */
export function stripHttpClientDoubleSlashLineComments(body: string): string {
  const normalized = normalizeHttpBodyNewlines(body);
  const lines = normalized.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("//")) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

/** Raw multipart body template: after stripping `//` lines, body starts with `--` (MIME delimiter). */
export function isRawMultipartTemplateBody(body: unknown): boolean {
  if (typeof body !== "string") return false;
  return stripHttpClientDoubleSlashLineComments(body)
    .trimStart()
    .startsWith("--");
}

/** Parse `boundary=` from a Content-Type value (RFC 2045 / multipart). */
export function parseMultipartBoundaryFromContentType(
  contentType: string,
): string | undefined {
  const m = contentType.match(
    /\bboundary\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i,
  );
  const v = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/** First line matching `--` + boundary (optional closing `--`); skips preamble lines. */
export function parseMultipartBoundaryFromBody(
  body: string,
): string | undefined {
  for (const line of normalizeHttpBodyNewlines(body).split("\n")) {
    const t = line.trim();
    if (t.length === 0) continue;
    const m = t.match(/^--(.+)$/);
    if (!m) continue;
    let core = m[1]!;
    if (core.endsWith("--")) core = core.slice(0, -2);
    if (core.length > 0) return core;
  }
  return undefined;
}

function formatMultipartBoundaryParameter(boundary: string): string {
  if (/^[A-Za-z0-9._'()+,-:=?]+$/.test(boundary)) return boundary;
  return JSON.stringify(boundary);
}

/**
 * If Content-Type is multipart but has no usable `boundary=`, infer it from the first
 * `--...` line in the body and append `; boundary=...`.
 */
export function ensureMultipartContentTypeHeader(
  headers: Record<string, string>,
  body: string,
): Record<string, string> {
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === "content-type",
  );
  if (!key) return headers;
  const val = headers[key];
  if (typeof val !== "string") return headers;
  if (!val.toLowerCase().includes("multipart/form-data")) return headers;
  const existing = parseMultipartBoundaryFromContentType(val);
  if (existing) return headers;
  const fromBody = parseMultipartBoundaryFromBody(body);
  if (!fromBody) return headers;
  const token = formatMultipartBoundaryParameter(fromBody);
  const trimmed = val.trim();
  const newVal = trimmed.endsWith(";")
    ? `${trimmed} boundary=${token}`
    : `${trimmed}; boundary=${token}`;
  return { ...headers, [key]: newVal };
}

function stripQuotesPath(p: string): string {
  const t = p.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/** Parse path and optional same-line suffix after `<` (e.g. `./a.txt --boundary--`). */
function parseInlineBodyFileRefTail(tail: string): {
  path: string;
  suffix: string;
} {
  let s = tail.trim().replace(/\r$/, "");
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    if (end === -1) return { path: stripQuotesPath(s), suffix: "" };
    return { path: s.slice(1, end), suffix: s.slice(end + 1).trimStart() };
  }
  if (s.startsWith("'")) {
    const end = s.indexOf("'", 1);
    if (end === -1) return { path: stripQuotesPath(s), suffix: "" };
    return { path: s.slice(1, end), suffix: s.slice(end + 1).trimStart() };
  }
  // First non-whitespace run is the path; rest is suffix (no artificial leading space — MIME
  // closing delimiters like `--boundary--` must not be prefixed with a space).
  const m = s.match(/^(\S+)\s*(.*)$/);
  if (!m) return { path: "", suffix: "" };
  const path = m[1] ?? "";
  const suffix = (m[2] ?? "").trimStart();
  return { path, suffix };
}

function dataEndsWithLineTerminator(data: Buffer): boolean {
  if (data.length === 0) return false;
  const b = data[data.length - 1]!;
  return b === 0x0a || b === 0x0d;
}

function dataEndsWithCrlf(data: Buffer): boolean {
  return (
    data.length >= 2 &&
    data[data.length - 2] === 0x0d &&
    data[data.length - 1] === 0x0a
  );
}

/** File ends with LF but not CRLF — MIME still needs `\r\n` before the next `--` delimiter. */
function dataEndsWithBareLf(data: Buffer): boolean {
  return (
    data.length > 0 &&
    data[data.length - 1] === 0x0a &&
    (data.length < 2 || data[data.length - 2] !== 0x0d)
  );
}

/**
 * Omit the newline that ends the `< path` line after injecting file bytes when:
 * - the next template line is blank (that blank supplies the NL before the boundary), or
 * - the next non-blank line starts a multipart boundary and the file already ends with a
 *   line terminator (avoid `…\\n` from file + `\\n` from `<` line before `--…`).
 */
function shouldOmitLineTerminatorAfterInlineFileRef(
  text: string,
  newlineIdx: number,
  fileData: Buffer,
): boolean {
  if (newlineIdx < 0) return false;
  const rest = text.slice(newlineIdx + 1);
  if (rest.length === 0) return false;

  const nb = rest.indexOf("\n");
  const firstLine = nb === -1 ? rest : rest.slice(0, nb);
  if (firstLine.trim() === "") {
    return true;
  }
  return (
    dataEndsWithLineTerminator(fileData) &&
    firstLine.trimStart().startsWith("--")
  );
}

/**
 * Replace inline `< path` body lines with file bytes (rest of line after the path is kept).
 * Used for raw `multipart/form-data` templates; paths resolve relative to `baseDir`.
 */
export async function resolveInlineBodyFileRefs(
  body: string,
  baseDir: string,
): Promise<Buffer> {
  const pathMod = await import("path");
  const fs = await import("fs/promises");
  const chunks: Buffer[] = [];
  // Always normalize newlines and strip `//` lines here so wire bytes are correct
  // even if a caller omits the same preprocessing as doRequest.
  const text = stripHttpClientDoubleSlashLineComments(body);
  let pos = 0;
  let skipBlankLineAfterFileTrailingNl = false;
  /** After omitting `<` line NL, inject CRLF before the next boundary when file ended with bare LF. */
  let prefixCrlfBeforeNextLine = false;
  while (pos <= text.length) {
    const nl = text.indexOf("\n", pos);
    const lineEnd = nl === -1 ? text.length : nl;
    const rawLine = text.slice(pos, lineEnd);
    const lineNl = nl === -1 ? "" : "\r\n";
    const m = rawLine.match(/^(\s*)<\s+(.+)$/);
    if (m?.[2]) {
      const { path: rel, suffix } = parseInlineBodyFileRefTail(m[2]);
      const cleaned = stripQuotesPath(rel);
      if (!cleaned) {
        skipBlankLineAfterFileTrailingNl = false;
        chunks.push(Buffer.from(rawLine + lineNl, "utf8"));
      } else {
        const resolved = pathMod.resolve(baseDir, cleaned);
        const data = await fs.readFile(resolved);
        chunks.push(Buffer.from(m[1] ?? "", "utf8"));
        chunks.push(data);
        const omitNl =
          lineNl !== "" &&
          nl !== -1 &&
          shouldOmitLineTerminatorAfterInlineFileRef(text, nl, data);
        if (suffix.length > 0) {
          if (!dataEndsWithCrlf(data)) {
            chunks.push(
              Buffer.from(!omitNl && lineNl !== "" ? lineNl : "\r\n", "utf8"),
            );
          }
          chunks.push(Buffer.from(suffix, "utf8"));
        } else {
          chunks.push(Buffer.from(omitNl ? "" : lineNl, "utf8"));
        }
        if (omitNl && dataEndsWithBareLf(data)) {
          prefixCrlfBeforeNextLine = true;
        }
        skipBlankLineAfterFileTrailingNl =
          omitNl &&
          dataEndsWithLineTerminator(data) &&
          nl !== -1 &&
          text.slice(nl + 1).startsWith("\n");
      }
    } else {
      if (skipBlankLineAfterFileTrailingNl && rawLine.trim() === "") {
        skipBlankLineAfterFileTrailingNl = false;
        if (nl === -1) break;
        pos = nl + 1;
        continue;
      }
      skipBlankLineAfterFileTrailingNl = false;
      if (prefixCrlfBeforeNextLine) {
        chunks.push(Buffer.from("\r\n", "utf8"));
        prefixCrlfBeforeNextLine = false;
      }
      chunks.push(Buffer.from(rawLine + lineNl, "utf8"));
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return Buffer.concat(chunks);
}

export function getRequestHeaderType(headers: unknown): RequestHeaderType {
  if (typeof headers !== "object" || headers === null) {
    return "invalid";
  }
  const contentTypeHeader = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "content-type",
  );
  if (!contentTypeHeader) {
    return "invalid";
  }
  const contentTypeValue = contentTypeHeader[1];
  if (typeof contentTypeValue === "string") {
    if (contentTypeValue.includes("application/json")) {
      return "json";
    }
    if (contentTypeValue.includes("multipart/form-data")) {
      return "form-data";
    }
    if (contentTypeValue.includes("application/x-www-form-urlencoded")) {
      return "form-urlencoded";
    }
  }
  return "invalid";
}

export function getJSONRequestBody(
  body: unknown,
): Record<string, unknown> | undefined {
  if (typeof body === "object" && body !== null) {
    return body as Record<string, unknown>;
  }
  return undefined;
}

export function getGraphQLRequestBody(
  body: unknown,
): { query: string; variables?: Record<string, unknown> } | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query: unknown }).query === "string"
  ) {
    const graphqlBody = body as {
      query: string;
      variables?: Record<string, unknown>;
    };
    return {
      query: graphqlBody.query,
      variables: graphqlBody.variables,
    };
  }
  // Body-from-file (< path) resolves to raw GraphQL text for GRAPHQL requests
  if (typeof body === "string" && body.trim().length > 0) {
    const parsed = parseGraphQLContent(body);
    if (parsed.query.length > 0) {
      return parsed;
    }
  }
  return undefined;
}

/** Parse "key=value&key2=value2" into an object (application/x-www-form-urlencoded). */
export function parseFormUrlEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      out[decodeURIComponent(pair.trim())] = "";
    } else {
      out[decodeURIComponent(pair.slice(0, eq).trim())] = decodeURIComponent(
        pair
          .slice(eq + 1)
          .trim()
          .replace(/\+/g, " "),
      );
    }
  }
  return out;
}

export function getFormRequestBody(
  body: unknown,
  formType: "form-data" | "form-urlencoded",
): Record<string, unknown> | undefined {
  if (formType === "form-urlencoded") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  if (formType === "form-data") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      if (isRawMultipartTemplateBody(body)) {
        return undefined;
      }
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  return undefined;
}

/** True if body is a "read body from file" reference: { __bodyFromFile: string }. */
export function isBodyFromFileRef(
  body: unknown,
): body is KulalaRequestBodyFromFileContent {
  return (
    typeof body === "object" &&
    body !== null &&
    "__bodyFromFile" in body &&
    typeof (body as { __bodyFromFile: unknown }).__bodyFromFile === "string"
  );
}

/**
 * Resolve body-from-file: read file at path (relative to baseDir) and return its contents as string.
 * @throws if file cannot be read
 */
export async function resolveBodyFromFile(
  filePath: string,
  baseDir: string,
): Promise<string> {
  const path = await import("path");
  const fs = await import("fs/promises");
  const resolved = path.resolve(baseDir, filePath);
  const content = await fs.readFile(resolved, "utf-8");
  return content;
}

/**
 * Resolve a body-from-file reference. For GRAPHQL, returns `{ query, variables? }`;
 * inline variables in the .http file (after `< path`) override variables from the file.
 */
export async function resolveEffectiveBodyFromFileRef(
  ref: KulalaRequestBodyFromFileContent,
  baseDir: string,
  method?: string,
): Promise<string | { query: string; variables?: Record<string, unknown> }> {
  const fileContent = await resolveBodyFromFile(ref.__bodyFromFile, baseDir);
  if ((method ?? "").toUpperCase() !== "GRAPHQL") {
    return fileContent;
  }
  const fromFile = parseGraphQLContent(fileContent);
  const suffixVars = ref.__graphqlVariablesSuffix
    ? parseGraphQLVariablesJson(ref.__graphqlVariablesSuffix)
    : undefined;
  return {
    query: fromFile.query,
    ...(suffixVars !== undefined
      ? { variables: suffixVars }
      : fromFile.variables !== undefined
        ? { variables: fromFile.variables }
        : {}),
  };
}

/** True if value looks like a file reference: { filePath: string, filename?: string }. */
export function isFileRef(
  value: unknown,
): value is { filePath: string; filename?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "filePath" in value &&
    typeof (value as { filePath: unknown }).filePath === "string"
  );
}

/**
 * Build FormData for multipart/form-data. Body entries can be strings or
 * file refs { filePath, filename? }. Paths are resolved relative to baseDir.
 */
export async function buildMultipartBody(
  body: Record<string, unknown>,
  baseDir: string,
): Promise<FormData> {
  const path = await import("path");
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (isFileRef(value)) {
      const resolvedPath = path.resolve(baseDir, value.filePath);
      const file = Bun.file(resolvedPath);
      form.append(
        key,
        file,
        value.filename ?? value.filePath.split(/[/\\]/).pop(),
      );
    } else {
      form.append(key, String(value ?? ""));
    }
  }
  return form;
}
