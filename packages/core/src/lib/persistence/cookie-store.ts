import { getDb } from "./db";

export type CookieRecord = {
  domain: string;
  path: string;
  name: string;
  value: string;
  expiresAt?: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export type NormalizedSetCookie = {
  domain: string;
  path: string;
  name: string;
  value: string;
  secure: boolean;
  expiresAt?: string;
};

function parseSetCookieHeader(header: string): {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expiresAt?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  maxAgeSeconds?: number;
} | null {
  const parts = header
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const [nv, ...attrs] = parts;
  const eq = nv.indexOf("=");
  if (eq === -1) return null;
  const name = nv.slice(0, eq).trim();
  const value = nv.slice(eq + 1).trim();
  if (!name) return null;

  const out: ReturnType<typeof parseSetCookieHeader> = {
    name,
    value,
  };

  for (const a of attrs) {
    const [kRaw, ...rest] = a.split("=");
    const k = (kRaw ?? "").trim().toLowerCase();
    const v = rest.join("=").trim();
    if (k === "domain" && v) out.domain = v.replace(/^\./, "").toLowerCase();
    else if (k === "path" && v) out.path = v;
    else if (k === "expires" && v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) out.expiresAt = d.toISOString();
    } else if (k === "max-age" && v) {
      const n = Number(v);
      if (Number.isFinite(n)) out.maxAgeSeconds = Math.trunc(n);
    } else if (k === "samesite" && v) out.sameSite = v;
    else if (k === "secure") out.secure = true;
    else if (k === "httponly") out.httpOnly = true;
  }

  if (out.maxAgeSeconds !== undefined) {
    out.expiresAt = new Date(
      Date.now() + out.maxAgeSeconds * 1000,
    ).toISOString();
  }

  return out;
}

function defaultPathForUrl(url: URL): string {
  const p = url.pathname || "/";
  if (!p.startsWith("/")) return "/";
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  return idx <= 0 ? "/" : p.slice(0, idx);
}

export function domainMatches(host: string, cookieDomain: string): boolean {
  const h = host.toLowerCase();
  const d = cookieDomain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (!requestPath.startsWith("/")) return false;
  if (!cookiePath.startsWith("/")) return false;
  return (
    requestPath === cookiePath ||
    requestPath.startsWith(
      cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`,
    )
  );
}

/**
 * Parse a single Set-Cookie header line and resolve Domain/Path the same way as
 * storeCookiesFromResponse (host-only default domain when Domain is omitted).
 */
export function normalizeSetCookieFromLine(
  setCookieLine: string,
  responseUrlStr: string,
): NormalizedSetCookie | null {
  const parsed = parseSetCookieHeader(setCookieLine);
  if (!parsed) return null;
  const url = new URL(responseUrlStr);
  const host = url.hostname.toLowerCase();
  const domain = (parsed.domain ?? host).toLowerCase();
  const path = parsed.path ?? defaultPathForUrl(url);
  const now = nowIso();
  if (parsed.expiresAt && parsed.expiresAt <= now) return null;
  return {
    domain,
    path,
    name: parsed.name,
    value: parsed.value,
    secure: !!parsed.secure,
    expiresAt: parsed.expiresAt,
  };
}

/** Whether a cookie normalized from Set-Cookie should be sent on a request to requestUrlStr. */
export function cookieAppliesToRequest(
  c: NormalizedSetCookie,
  requestUrlStr: string,
): boolean {
  const url = new URL(requestUrlStr);
  const host = url.hostname.toLowerCase();
  const reqPath = url.pathname || "/";
  if (!domainMatches(host, c.domain)) return false;
  if (!pathMatches(reqPath, c.path)) return false;
  if (c.secure && host !== 'localhost' && url.protocol !== "https:") return false;
  const now = nowIso();
  if (c.expiresAt && c.expiresAt <= now) return false;
  return true;
}

export function storeCookiesFromResponse(
  urlStr: string,
  setCookieHeaders: string[],
): void {
  const url = new URL(urlStr);
  const host = url.hostname.toLowerCase();
  const db = getDb();
  const now = nowIso();

  for (const h of setCookieHeaders) {
    const parsed = parseSetCookieHeader(h);
    if (!parsed) continue;

    const domain = (parsed.domain ?? host).toLowerCase();
    const path = parsed.path ?? defaultPathForUrl(url);
    const expiresAt = parsed.expiresAt ?? null;
    const secure = parsed.secure ? 1 : 0;
    const httpOnly = parsed.httpOnly ? 1 : 0;
    const sameSite = parsed.sameSite ?? null;

    // Expired -> delete
    if (expiresAt && expiresAt <= now) {
      db.run(
        "DELETE FROM cookie_jar WHERE domain = ? AND path = ? AND name = ?",
        [domain, path, parsed.name],
      );
      continue;
    }

    db.run(
      `INSERT INTO cookie_jar (domain, path, name, value, expires_at, secure, http_only, same_site, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain, path, name) DO UPDATE SET
         value = excluded.value,
         expires_at = excluded.expires_at,
         secure = excluded.secure,
         http_only = excluded.http_only,
         same_site = excluded.same_site,
         updated_at = excluded.updated_at`,
      [
        domain,
        path,
        parsed.name,
        parsed.value,
        expiresAt,
        secure,
        httpOnly,
        sameSite,
        now,
      ],
    );
  }
}

export function getCookieHeaderForRequest(urlStr: string): string | undefined {
  const url = new URL(urlStr);
  const host = url.hostname.toLowerCase();
  const reqPath = url.pathname || "/";
  const isHttps = url.protocol === "https:";
  const now = nowIso();
  const db = getDb();

  // Fetch all candidates by domain; filter in JS for suffix match + path match.
  const rows = db
    .query<
      {
        domain: string;
        path: string;
        name: string;
        value: string;
        expires_at: string | null;
        secure: number;
      },
      []
    >(
      `SELECT domain, path, name, value, expires_at, secure
       FROM cookie_jar`,
    )
    .all();

  const out: Array<{ name: string; value: string }> = [];
  for (const r of rows) {
    if (!domainMatches(host, r.domain)) continue;
    if (!pathMatches(reqPath, r.path)) continue;
    if (r.secure === 1 && !isHttps) continue;
    if (r.expires_at && r.expires_at <= now) continue;
    out.push({ name: r.name, value: r.value });
  }
  if (out.length === 0) return undefined;
  // deterministic order
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out.map((c) => `${c.name}=${c.value}`).join("; ");
}
