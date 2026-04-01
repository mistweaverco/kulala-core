import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type {
  NodeHttpClientOptions,
  NodeHttpClientResponse,
  NodeHttpClientTimings,
} from "./http-client";
import { resolveCurlPath } from "./embedded-curl";
import { performance } from "node:perf_hooks";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";

type CurlWriteOut = {
  http_code: number;
  url_effective: string;
  time_namelookup: number;
  time_connect: number;
  time_appconnect: number;
  time_pretransfer: number;
  time_starttransfer: number;
  time_total: number;
  time_redirect: number;
};

function parseCurlWriteOut(stdout: string): CurlWriteOut {
  const out: Partial<Record<keyof CurlWriteOut, string>> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq) as keyof CurlWriteOut;
    const v = line.slice(eq + 1);
    out[k] = v;
  }

  const num = (k: keyof CurlWriteOut): number => {
    const raw = out[k];
    if (raw == null || raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    http_code: Math.trunc(num("http_code")),
    url_effective: out.url_effective ?? "",
    time_namelookup: num("time_namelookup"),
    time_connect: num("time_connect"),
    time_appconnect: num("time_appconnect"),
    time_pretransfer: num("time_pretransfer"),
    time_starttransfer: num("time_starttransfer"),
    time_total: num("time_total"),
    time_redirect: num("time_redirect"),
  };
}

function secondsToMs(sec: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return sec * 1000;
}

function headersFromDump(dump: string): {
  statusCode: number;
  headers: Record<string, string>;
} {
  // curl --dump-header includes headers for redirects too; pick the last HTTP/* block.
  const normalized = dump.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("HTTP/"));
  const last = blocks.length ? blocks[blocks.length - 1] : "";
  if (!last) return { statusCode: 0, headers: {} };

  const lines = last.split("\n").filter(Boolean);
  const statusLine = lines[0] ?? "";
  const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  const statusCode = m ? parseInt(m[1], 10) : 0;

  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (!k) continue;
    if (k === "set-cookie") {
      // Preserve multiple Set-Cookie headers (cookie jar needs them split).
      headers[k] = headers[k] ? `${headers[k]}\n${v}` : v;
    } else {
      headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
    }
  }
  return { statusCode, headers };
}

function buildTimings(w: CurlWriteOut): NodeHttpClientTimings {
  const dns = secondsToMs(w.time_namelookup);
  const connect = secondsToMs(w.time_connect);
  const appconnect = secondsToMs(w.time_appconnect);
  const pretransfer = secondsToMs(w.time_pretransfer);
  const startTransfer = secondsToMs(w.time_starttransfer);
  const total = secondsToMs(w.time_total);
  const redirect = secondsToMs(w.time_redirect);

  const tcp = Math.max(0, connect - dns);
  const tls =
    appconnect > 0 && connect > 0 ? Math.max(0, appconnect - connect) : 0;

  // Approximate: pretransfer is "ready to transfer"; treat it as request time.
  // Then firstByte = startTransfer - pretransfer (server think + network to first byte).
  const request = Math.max(0, pretransfer - (dns + tcp + tls));
  const firstByte = Math.max(0, startTransfer - pretransfer);

  return {
    phases: {
      dns,
      tcp,
      tls,
      request,
      firstByte,
      startTransfer,
      redirect,
      total,
    },
  };
}

async function runCurl(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const curlPath = await resolveCurlPath();
  const env = { ...process.env };
  if (!env.CURL_CA_BUNDLE) {
    try {
      const ca = join(dirname(curlPath), "curl-ca-bundle.crt");
      await access(ca, fsConstants.R_OK);
      env.CURL_CA_BUNDLE = ca;
    } catch {
      // ignore
    }
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(curlPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 0,
      });
    });
  });
}

export async function curlHttpRequest(
  options: NodeHttpClientOptions,
): Promise<NodeHttpClientResponse> {
  const MAX_REDIRECTS = 10;
  const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
  const followRedirects = options.followRedirects !== false;

  const wallStart = performance.now();
  let redirectTime = 0;
  let elapsedBeforeFinal = 0;

  let currentUrl = options.url;
  let currentMethod = (options.method || "GET").toUpperCase();
  let currentHeaders = { ...(options.headers ?? {}) };
  let currentBody: string | Buffer | undefined = options.body as
    | string
    | Buffer
    | undefined;

  const chain: NonNullable<NodeHttpClientResponse["redirectChain"]> = [];

  // In-request cookie propagation across redirects (JetBrains-like behavior).
  // This is separate from the persisted cookie jar; it's needed so cookies set on a
  // redirect response are available to the next hop within the same request.
  const propagateCookies = options.propagateCookiesOnRedirect !== false;
  const cookieMap: Record<string, string> = {};
  const parseCookieHeader = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const part of raw.split(";")) {
      const p = part.trim();
      if (!p) continue;
      const eq = p.indexOf("=");
      if (eq === -1) continue;
      const k = p.slice(0, eq).trim();
      const v = p.slice(eq + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  };
  const mergeCookieHeader = (existing: string | undefined): string => {
    const merged: Record<string, string> = {
      ...(existing ? parseCookieHeader(existing) : {}),
      ...cookieMap,
    };
    return Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  };
  const absorbSetCookieFromHeaders = (
    headers: Record<string, string>,
  ): void => {
    const raw = headers["set-cookie"];
    if (!raw) return;
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const line of lines) {
      const first = line.split(";", 1)[0] ?? "";
      const eq = first.indexOf("=");
      if (eq === -1) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) cookieMap[name] = value;
    }
  };

  const requestOnce = async (): Promise<NodeHttpClientResponse> => {
    const tempBase = await fs.mkdtemp(join(tmpdir(), "kulala-curl-"));
    const bodyPath = join(tempBase, `body-${randomUUID()}`);
    const headerPath = join(tempBase, `headers-${randomUUID()}`);
    const cleanup = async (): Promise<void> => {
      await fs.rm(tempBase, { recursive: true, force: true });
    };

    const writeOut = [
      "http_code=%{http_code}",
      "url_effective=%{url_effective}",
      "time_namelookup=%{time_namelookup}",
      "time_connect=%{time_connect}",
      "time_appconnect=%{time_appconnect}",
      "time_pretransfer=%{time_pretransfer}",
      "time_starttransfer=%{time_starttransfer}",
      "time_total=%{time_total}",
      "time_redirect=%{time_redirect}",
      "",
    ].join("\n");

    const args: string[] = [
      "--silent",
      "--show-error",
      "--request",
      currentMethod,
      "--dump-header",
      headerPath,
      "--output",
      bodyPath,
      "--write-out",
      writeOut,
    ];

    if (options.insecure) {
      args.push("--insecure");
    }
    if (options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs)) {
      const sec = Math.max(0, options.timeoutMs / 1000);
      // curl expects seconds (can be fractional)
      args.push("--max-time", String(sec));
    }
    if (
      options.connectionTimeoutMs !== undefined &&
      Number.isFinite(options.connectionTimeoutMs)
    ) {
      const sec = Math.max(0, options.connectionTimeoutMs / 1000);
      args.push("--connect-timeout", String(sec));
    }

    // Protocol selection
    if (options.httpVersion === "HTTP/1.0") args.push("--http1.0");
    else if (options.httpVersion === "HTTP/1.1") args.push("--http1.1");
    else if (options.httpVersion === "HTTP/2") {
      const parsed = new URL(currentUrl);
      if (parsed.protocol === "https:") {
        args.push("--http2");
      } else if (parsed.protocol === "http:") {
        args.push("--http2-prior-knowledge");
      } else {
        throw new Error("HTTP/2 is only supported for http/https URLs");
      }
    }

    // Headers
    for (const [k, v] of Object.entries(currentHeaders)) {
      args.push("--header", `${k}: ${v}`);
    }

    // Body
    if (currentBody !== undefined) {
      const body =
        typeof currentBody === "string" || Buffer.isBuffer(currentBody)
          ? currentBody
          : Buffer.from(String(currentBody));
      const uploadPath = join(tempBase, `upload-${randomUUID()}`);
      await fs.writeFile(uploadPath, body);
      args.push("--data-binary", `@${uploadPath}`);
    }

    args.push(currentUrl);

    try {
      const { stdout, stderr, exitCode } = await runCurl(args);
      if (exitCode !== 0) {
        const msg = stderr.trim() || `curl failed with exit code ${exitCode}`;
        throw new Error(msg);
      }

      const w = parseCurlWriteOut(stdout);
      const dump = await fs.readFile(headerPath, "utf-8");
      const { statusCode, headers } = headersFromDump(dump);
      const body = await fs.readFile(bodyPath);
      const timings = buildTimings(w);
      return {
        statusCode: statusCode || w.http_code || 0,
        headers,
        body,
        timings,
        url: w.url_effective || currentUrl,
        firstByteTime: 0,
      };
    } finally {
      await cleanup();
    }
  };

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await requestOnce();
    if (propagateCookies) absorbSetCookieFromHeaders(res.headers);
    chain.push({
      statusCode: res.statusCode,
      headers: res.headers,
      body: res.body,
      timings: res.timings,
      url: res.url,
    });

    const location = res.headers["location"];
    const isRedirect =
      followRedirects && REDIRECT_STATUSES.has(res.statusCode) && !!location;

    if (!isRedirect) {
      // Aggregate redirect + wall-clock total across hops.
      const wallTotal = performance.now() - wallStart;
      elapsedBeforeFinal = wallTotal - (res.timings.phases.total ?? 0);

      const phases = { ...res.timings.phases };
      phases.redirect = redirectTime;
      phases.total = wallTotal;
      // Adjust startTransfer to include time spent in previous hops (best-effort).
      phases.startTransfer =
        (phases.startTransfer ?? 0) > 0
          ? elapsedBeforeFinal + (phases.startTransfer ?? 0)
          : phases.startTransfer;
      res.timings.phases = phases;

      return { ...res, redirectChain: chain, url: res.url };
    }

    if (i === MAX_REDIRECTS) {
      throw new Error(`Maximum redirects (${MAX_REDIRECTS}) exceeded`);
    }

    redirectTime += res.timings.phases.total ?? 0;

    currentUrl = new URL(location!, currentUrl).href;

    // Apply any cookies accumulated so far to the next hop, unless caller already set Cookie.
    if (propagateCookies) {
      if (
        !Object.keys(currentHeaders).some((k) => k.toLowerCase() === "cookie")
      ) {
        const cookie = mergeCookieHeader(undefined);
        if (cookie) currentHeaders.Cookie = cookie;
      } else {
        const existingKey = Object.keys(currentHeaders).find(
          (k) => k.toLowerCase() === "cookie",
        );
        if (existingKey) {
          currentHeaders[existingKey] = mergeCookieHeader(
            currentHeaders[existingKey],
          );
        }
      }
    }

    if (
      (res.statusCode === 301 ||
        res.statusCode === 302 ||
        res.statusCode === 303) &&
      !(currentMethod === "POST" && currentBody !== undefined)
    ) {
      // Historically many clients switch POST to GET for 301/302/303.
      // However, GraphQL endpoints frequently redirect and require the POST body.
      // Preserve POST+body by default; only switch for non-POST or bodyless requests.
      currentMethod = "GET";
      currentBody = undefined;
      currentHeaders = Object.fromEntries(
        Object.entries(currentHeaders).filter(
          ([k]) =>
            k.toLowerCase() !== "content-length" &&
            k.toLowerCase() !== "content-type",
        ),
      );
    }
  }

  throw new Error(`Maximum redirects (${MAX_REDIRECTS}) exceeded`);
}
