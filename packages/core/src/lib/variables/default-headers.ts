import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  dirsUpward,
  HTTP_CLIENT_ENV_JSON,
  HTTP_CLIENT_PRIVATE_ENV_JSON,
} from "./env-files";

/** Kulala-only top-level section in http-client.env.json (shared variables + `$kulalaDefaultHeaders`). */
export const KULALA_SHARED_KEY = "$kulalaShared";
/** Kulala-only default HTTP headers under `$kulalaShared` or per-environment. */
export const DEFAULT_HEADERS_KEY = "$kulalaDefaultHeaders";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function headersObjectToRecord(obj: unknown): Record<string, string> {
  if (!isPlainObject(obj)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[k] = String(v);
    }
  }
  return out;
}

function readDefaultHeadersFromFile(
  filePath: string,
  env: string,
): { kulalaShared: Record<string, string>; perEnv: Record<string, string> } {
  const kulalaShared: Record<string, string> = {};
  const perEnv: Record<string, string> = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { kulalaShared, perEnv };

    const sharedSection = parsed[KULALA_SHARED_KEY];
    if (isPlainObject(sharedSection)) {
      Object.assign(
        kulalaShared,
        headersObjectToRecord(sharedSection[DEFAULT_HEADERS_KEY]),
      );
    }

    const envSection = parsed[env];
    if (isPlainObject(envSection)) {
      Object.assign(
        perEnv,
        headersObjectToRecord(envSection[DEFAULT_HEADERS_KEY]),
      );
    }
  } catch {
    // ignore unreadable files
  }
  return { kulalaShared, perEnv };
}

/**
 * Load merged default HTTP headers from http-client.env.json files.
 * Order (later overrides earlier): `$kulalaShared.$kulalaDefaultHeaders` then `[env].$kulalaDefaultHeaders`.
 * Files are merged root → closest directory (closest wins), matching env variable resolution.
 */
export function loadDefaultHeaders(
  env: string,
  startDir: string,
): Record<string, string> {
  const dirs = dirsUpward(startDir);
  let kulalaShared: Record<string, string> = {};
  let perEnv: Record<string, string> = {};

  for (const fileName of [
    HTTP_CLIENT_ENV_JSON,
    HTTP_CLIENT_PRIVATE_ENV_JSON,
  ] as const) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = join(dirs[i]!, fileName);
      if (!existsSync(p)) continue;
      const parsed = readDefaultHeadersFromFile(p, env);
      kulalaShared = { ...kulalaShared, ...parsed.kulalaShared };
      perEnv = { ...perEnv, ...parsed.perEnv };
    }
  }

  return { ...kulalaShared, ...perEnv };
}

/** Strip scheme/path from a Host header value for the wire-format `Host` field. */
function hostHeaderAuthority(raw: string): string {
  return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

/**
 * Build a URL origin from a Host header value (JetBrains HTTP Client).
 * Full URLs keep their scheme; bare hostnames default to `http://`.
 */
function hostHeaderValueToUrlBase(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return trimmed.replace(/\/+$/, "");
    }
  }
  return `http://${hostHeaderAuthority(trimmed)}`;
}

/**
 * JetBrains-style `Host` header: normalize to hostname and prefix relative request URLs.
 * When `Host` is `https://api.example.com` and the request target is `/path`, the URL becomes
 * `https://api.example.com/path` and `Host` is sent as `api.example.com`.
 * Bare hostnames (`api.example.com`) use `http://` as the default scheme.
 */
export function resolveUrlFromHostHeader(opts: {
  headers: Record<string, string>;
  url: string;
}): {
  headers: Record<string, string>;
  url: string;
} {
  const headers = { ...opts.headers };
  let url = opts.url;
  const hostKey = Object.keys(headers).find((k) => k.toLowerCase() === "host");
  if (!hostKey) return { headers, url };

  const raw = String(headers[hostKey] ?? "");
  headers[hostKey] = hostHeaderAuthority(raw);
  if (url === "" || url.startsWith("/")) {
    const base = hostHeaderValueToUrlBase(raw);
    url = url === "" ? `${base}/` : `${base}${url}`;
  }
  return { headers, url };
}

/**
 * Apply env default headers without overriding headers already set on the request.
 * Handles JetBrains-style default `Host` (sets host header and prefixes relative URLs).
 */
export function applyDefaultHeaders(opts: {
  headers: Record<string, string>;
  url: string;
  defaultHeaders: Record<string, string>;
}): { headers: Record<string, string>; url: string } {
  const headers = { ...opts.headers };
  const url = opts.url;
  const existingLc = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  let addedDefaultHost = false;

  for (const [name, value] of Object.entries(opts.defaultHeaders)) {
    if (name === "Host") {
      if (existingLc.has("host")) continue;
      headers.Host = String(value);
      existingLc.add("host");
      addedDefaultHost = true;
      continue;
    }
    if (!existingLc.has(name.toLowerCase())) {
      headers[name] = value;
      existingLc.add(name.toLowerCase());
    }
  }

  if (addedDefaultHost) {
    return resolveUrlFromHostHeader({ headers, url });
  }
  return { headers, url };
}
