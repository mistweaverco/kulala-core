/**
 * HTTP client using node:http, node:https, and node:http2 with timing instrumentation
 * to match the timings shape previously provided by got (dns, tcp, tls, request, firstByte, total).
 */

import type { OutgoingHttpHeaders } from "node:http";
import type { ClientHttp2Session } from "node:http2";
import type { FormDataLike } from "form-data-encoder";

export type NodeHttpClientTimings = {
  phases: {
    dns: number;
    tcp: number;
    tls: number;
    request: number;
    /** Time from request sent to first byte (server TTFB). */
    firstByte: number;
    /** Time from start (t0) to first byte; matches curl time_starttransfer. */
    startTransfer: number;
    /** Total time spent on redirect steps (curl time_redirect). 0 if no redirects. */
    redirect: number;
    total: number;
  };
};

export type NodeHttpClientResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string | Buffer;
  timings: NodeHttpClientTimings;
  /** Final resolved URL (after redirects). */
  url: string;
  /** performance.now() when first byte of this response was received (for startTransfer from wall start). */
  firstByteTime: number;
};

export type NodeHttpClientOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Body: string, Buffer, or FormData (multipart). For FormData we encode with form-data-encoder. */
  body?: string | Buffer | FormData;
  /** When "HTTP/2", use http2 for https URLs. Otherwise use http/https. */
  httpVersion?: "HTTP/1.0" | "HTTP/1.1" | "HTTP/2";
};

function now(): number {
  return performance.now();
}

function headersToRecord(
  h: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v !== undefined) out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

async function requestHttp1(
  parsed: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer | string | undefined,
): Promise<NodeHttpClientResponse> {
  const http =
    parsed.protocol === "https:"
      ? await import("node:https")
      : await import("node:http");
  const t0 = now();
  const phases = {
    dns: 0,
    tcp: 0,
    tls: 0,
    request: 0,
    firstByte: 0,
    startTransfer: 0,
    redirect: 0,
    total: 0,
  };
  let dnsEnd = 0;
  let tcpEnd = 0;
  let tlsEnd = 0;
  let requestEnd = 0;
  let firstByteTime = 0;

  return new Promise((resolve, reject) => {
    const path = parsed.pathname + parsed.search;
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: path || "/",
        method,
        headers:
          body !== undefined
            ? { ...headers, "Content-Length": Buffer.byteLength(body) }
            : headers,
        rejectUnauthorized: true,
      },
      (res) => {
        firstByteTime = firstByteTime || now();
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          // If we have tcp but no dns (e.g. socket already connected when assigned), treat start as dns end
          if (tcpEnd && !dnsEnd) dnsEnd = t0;
          // Compute all phases once we have all timestamps (avoids race where
          // 'finish' fires before socket 'connect'/'secureConnect').
          const connectionReady = tlsEnd || tcpEnd || dnsEnd || t0;
          phases.dns = dnsEnd ? dnsEnd - t0 : 0;
          phases.tcp = tcpEnd ? tcpEnd - (dnsEnd || t0) : 0;
          phases.tls = tlsEnd && tcpEnd ? tlsEnd - tcpEnd : 0;
          phases.request = requestEnd ? requestEnd - connectionReady : 0;
          phases.firstByte = firstByteTime
            ? firstByteTime - (requestEnd || connectionReady)
            : 0;
          phases.startTransfer = firstByteTime ? firstByteTime - t0 : 0;
          phases.total = now() - t0;
          const bodyBuf = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: headersToRecord(
              res.headers as Record<string, string | string[] | undefined>,
            ),
            body: bodyBuf,
            timings: { phases },
            url: parsed.href,
            firstByteTime: firstByteTime || 0,
          });
        });
      },
    );

    req.on("socket", (socket) => {
      // Socket may already be connected (e.g. from agent pool). Capture state at assignment
      // so we don't rely on events that already fired. Node: net.Socket has .connecting,
      // TLSSocket has .encrypted.
      const tSocket = now();
      const s = socket as { connecting?: boolean; encrypted?: boolean };
      if (s.connecting === false) {
        tcpEnd = tSocket;
      }
      if (s.encrypted === true) {
        tlsEnd = tSocket;
      }
      // prependOnceListener so we run before any other listener (e.g. agent)
      socket.prependOnceListener("lookup", () => {
        dnsEnd = now();
      });
      socket.prependOnceListener("connect", () => {
        tcpEnd = now();
      });
      socket.prependOnceListener("secureConnect", () => {
        tlsEnd = now();
      });
    });

    req.on("finish", () => {
      requestEnd = now();
    });

    req.on("error", reject);

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function requestHttp2(
  parsed: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  body: Buffer | string | undefined,
): Promise<NodeHttpClientResponse> {
  const http2 = await import("node:http2");
  const t0 = now();
  const phases = {
    dns: 0,
    tcp: 0,
    tls: 0,
    request: 0,
    firstByte: 0,
    startTransfer: 0,
    redirect: 0,
    total: 0,
  };
  let requestEnd = 0;
  let firstByteTime = 0;

  const session = await new Promise<ClientHttp2Session>((resolve, reject) => {
    const authority = parsed.origin;
    const client = http2.connect(
      authority,
      { rejectUnauthorized: true },
      () => {},
    );
    client.on("connect", () => {
      const connectTime = now();
      phases.dns = 0;
      phases.tcp = connectTime - t0;
      phases.tls = 0;
      resolve(client);
    });
    client.on("error", reject);
  });

  try {
    return await new Promise((resolve, reject) => {
      const path = parsed.pathname + parsed.search || "/";
      const reqHeaders: Record<string, string> = {
        ...(headers as Record<string, string>),
        ":method": method,
        ":path": path,
        ":scheme": parsed.protocol.slice(0, -1),
        ":authority": parsed.host,
      };
      if (body !== undefined) {
        reqHeaders["content-length"] = String(Buffer.byteLength(body));
      }
      const stream = session.request(reqHeaders);

      requestEnd = now();
      phases.request = requestEnd - t0;

      stream.on("response", (hdrs) => {
        firstByteTime = firstByteTime || now();
        phases.firstByte = firstByteTime - requestEnd;
        phases.startTransfer = firstByteTime - t0;
        const responseHeaders = headersToRecord(
          hdrs as Record<string, string | string[] | undefined>,
        );
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => {
          phases.total = now() - t0;
          const bodyBuf = Buffer.concat(chunks);
          const status = responseHeaders[":status"];
          resolve({
            statusCode: status ? parseInt(status, 10) : 0,
            headers: Object.fromEntries(
              Object.entries(responseHeaders).filter(
                ([k]) => !k.startsWith(":"),
              ),
            ),
            body: bodyBuf,
            timings: { phases },
            url: parsed.href,
            firstByteTime: firstByteTime || 0,
          });
        });
      });
      stream.on("error", reject);

      if (body !== undefined) {
        stream.write(body, () => {});
      }
      stream.end();
    });
  } finally {
    session.close();
  }
}

/** Encode FormData to buffer and content-type using form-data-encoder. */
async function encodeFormData(
  form: FormData,
): Promise<{ body: Buffer; contentType: string }> {
  const { FormDataEncoder } = await import("form-data-encoder");
  const encoder = new FormDataEncoder(form as unknown as FormDataLike);
  const chunks: Uint8Array[] = [];
  for await (const chunk of encoder) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const contentType = encoder.contentType;
  return { body, contentType };
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const MAX_REDIRECTS = 10;

/**
 * Perform an HTTP request using node:http / node:https / node:http2 with timing instrumentation.
 * Follows redirects and sets phases.redirect to the total time spent on redirect steps (curl semantics).
 */
export async function nodeHttpRequest(
  options: NodeHttpClientOptions,
): Promise<NodeHttpClientResponse> {
  const method = (options.method || "GET").toUpperCase();
  let currentUrl = options.url;
  let currentMethod = method;
  let currentHeaders = { ...options.headers };
  let body: Buffer | string | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      const { body: encoded, contentType } = await encodeFormData(options.body);
      body = encoded;
      currentHeaders["Content-Type"] = contentType;
      currentHeaders["Content-Length"] = String(encoded.length);
    } else if (typeof options.body === "string") {
      body = options.body;
    } else {
      body = options.body;
    }
  }
  let currentBody = body;
  let redirectTime = 0;
  const wallStart = now();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const parsed = new URL(currentUrl);
    const useHttp2 =
      options.httpVersion === "HTTP/2" &&
      (parsed.protocol === "https:" || parsed.protocol === "http2:");

    const res =
      useHttp2 && parsed.protocol === "https:"
        ? await requestHttp2(parsed, currentMethod, currentHeaders, currentBody)
        : await requestHttp1(
            parsed,
            currentMethod,
            currentHeaders,
            currentBody,
          );

    const isRedirect =
      REDIRECT_STATUSES.includes(res.statusCode) &&
      res.headers.location != null &&
      res.headers.location !== "";

    if (isRedirect && redirectCount < MAX_REDIRECTS) {
      redirectTime += res.timings.phases.total;
      currentUrl = new URL(res.headers.location, currentUrl).href;
      if (
        res.statusCode === 301 ||
        res.statusCode === 302 ||
        res.statusCode === 303
      ) {
        currentMethod = "GET";
        currentBody = undefined;
        currentHeaders = Object.fromEntries(
          Object.entries(currentHeaders).filter(
            (k) =>
              k[0].toLowerCase() !== "content-length" &&
              k[0].toLowerCase() !== "content-type",
          ),
        ) as Record<string, string>;
      }
      continue;
    }

    res.timings.phases.redirect = redirectTime;
    res.timings.phases.total = now() - wallStart;
    res.timings.phases.startTransfer =
      res.firstByteTime > 0
        ? res.firstByteTime - wallStart
        : res.timings.phases.startTransfer;
    return { ...res, url: currentUrl };
  }

  throw new Error(`Maximum redirects (${MAX_REDIRECTS}) exceeded`);
}
