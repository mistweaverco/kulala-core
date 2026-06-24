import { buildScriptCookies } from "./script-request-context";
import type { RunnerResponseLike } from "./types";
import type { KulalaRequestSuccessResponse } from "./types";

/** Mirrors JetBrains ContentType (Content-Type header). */
export type ScriptContentType = {
  mimeType: string;
  charset: string;
};

type ScriptHeaders = {
  valueOf: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
  valuesOf: (name: string) => string[];
};

export type ScriptResponse = {
  status: number;
  headers: ScriptHeaders;
  body: string | unknown;
  contentType: ScriptContentType;
  cookies: () => import("./script-request-context").ScriptCookie[];
  cookiesByName: (
    name: string,
  ) => import("./script-request-context").ScriptCookie[];
};

function makeHeaders(
  headers: Record<string, string> | undefined,
): ScriptHeaders {
  const lc: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) lc[k.toLowerCase()] = v;
  const get = (name: string) => lc[name.toLowerCase()];
  const valuesOf = (name: string) => {
    const v = get(name);
    if (v === undefined || v === "") return [];
    return v.includes("\n")
      ? v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [v];
  };
  return { get, valueOf: get, valuesOf };
}

function parseContentTypeHeader(header: string | undefined): ScriptContentType {
  if (!header || !header.trim()) return { mimeType: "", charset: "" };
  const main = header.split(";")[0]?.trim() ?? "";
  const mimeType = main || "";
  const m = header.match(/charset\s*=\s*([^;]+)/i);
  const raw = m?.[1]?.trim() ?? "";
  const charset = raw.replace(/^["']|["']$/g, "");
  return { mimeType, charset };
}

function isLikelyJsonContentType(ct: string): boolean {
  const c = ct.toLowerCase();
  return c.includes("json") || c.includes("+json");
}

function resolveScriptBody(
  text: string,
  contentTypeHeader: string | undefined,
): string | unknown {
  const ct = contentTypeHeader ?? "";
  const tryParse = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  if (isLikelyJsonContentType(ct) && text.trim().length > 0) {
    const parsed = tryParse();
    if (parsed !== undefined) return parsed;
    return text;
  }
  const t = text.trim();
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    const parsed = tryParse();
    if (parsed !== undefined) return parsed;
  }
  return text;
}

export function makeResponseForScripts(
  response?: RunnerResponseLike,
  responseUrl?: string,
): ScriptResponse {
  if (!response) {
    return {
      status: 0,
      headers: makeHeaders({}),
      body: "",
      contentType: { mimeType: "", charset: "" },
      cookies: () => [],
      cookiesByName: () => [],
    };
  }
  const bodyRaw = response.body;
  const text = typeof bodyRaw === "string" ? bodyRaw : String(bodyRaw ?? "");
  const ctHeader = response.headers["content-type"];
  const body = resolveScriptBody(text, ctHeader);
  const urlForCookies = responseUrl ?? "";
  const allCookies = () =>
    urlForCookies ? buildScriptCookies(response.headers, urlForCookies) : [];
  return {
    status: response.statusCode,
    headers: makeHeaders(response.headers),
    body,
    contentType: parseContentTypeHeader(ctHeader),
    cookies: allCookies,
    cookiesByName: (name: string) =>
      allCookies().filter((c) => c.name === name),
  };
}

export function runnerResponseLikeFromSuccess(
  result: KulalaRequestSuccessResponse,
): RunnerResponseLike {
  let body: unknown;
  if (result.rawBody !== undefined) {
    body = result.rawBody;
  } else if (result.body.type === "json") {
    body = JSON.stringify(result.body.content);
  } else if (result.body.type === "text") {
    body = result.body.content;
  } else {
    body = "";
  }
  return {
    body,
    statusCode: result.status,
    headers: result.headers,
    timings: {
      phases: result.timings ? { total: result.timings.total } : {},
    },
  };
}
