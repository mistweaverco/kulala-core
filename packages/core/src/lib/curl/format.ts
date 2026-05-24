import type { CurlFormatInput } from "./types";

function shellQuote(value: string, preferDouble = false): string {
  if (preferDouble) {
    if (!value.includes('"') && !value.includes("$")) return `"${value}"`;
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function httpVersionFlag(httpVersion: string | undefined): string[] {
  if (!httpVersion) return [];
  const v = httpVersion.replace(/^HTTP\//i, "").trim();
  if (v === "1.0") return ["--http1.0"];
  if (v === "1.1") return ["--http1.1"];
  if (v === "2" || v === "2.0") return ["--http2"];
  if (v === "3") return ["--http3"];
  return [];
}

/**
 * Format a resolved HTTP request as a copy-pasteable curl command (kulala.nvim Copy as cURL).
 */
export function formatCurlCommand(input: CurlFormatInput): string {
  const method = (input.method || "GET").toUpperCase();
  const headers = { ...(input.headers ?? {}) };
  let cookie = "";
  const cookieKey = Object.keys(headers).find(
    (k) => k.toLowerCase() === "cookie",
  );
  if (cookieKey) {
    cookie = headers[cookieKey]!;
    delete headers[cookieKey];
  }

  const parts: string[] = ["curl"];
  if (method !== "GET" && method !== "HEAD") {
    parts.push("-X", shellQuote(method));
  }
  if (input.verbose !== false) parts.push("-v");
  if (input.silent !== false) parts.push("-s");

  const body = input.body?.trim();
  if (body && body.length > 0) {
    parts.push("--data-binary", shellQuote(body, true));
  }

  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "user-agent") continue;
    parts.push("-H", shellQuote(`${k}:${v}`, true));
  }

  const ua = headers["User-Agent"] ?? headers["user-agent"] ?? input.userAgent;
  if (ua) parts.push("-A", shellQuote(ua));

  if (cookie) parts.push("--cookie", shellQuote(cookie));

  parts.push(...httpVersionFlag(input.httpVersion));
  const extra = input.extraCurlArgv ?? [];
  for (const arg of extra) {
    parts.push(/\s/.test(arg) ? shellQuote(arg) : arg);
  }

  parts.push(shellQuote(input.url));
  return parts.join(" ");
}
