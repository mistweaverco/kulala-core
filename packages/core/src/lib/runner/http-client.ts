/**
 * HTTP client using node:http, node:https, and node:http2 with timing instrumentation
 * to match the timings shape previously provided by got (dns, tcp, tls, request, firstByte, total).
 */

import type { FormDataLike } from "form-data-encoder";
import { curlHttpRequest } from "./curl-transport";

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
  /** Redirect response chain, in order (including the final response). */
  redirectChain?: Array<{
    statusCode: number;
    headers: Record<string, string>;
    body: string | Buffer;
    timings: NodeHttpClientTimings;
    url: string;
  }>;
};

export type NodeHttpClientOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Body: string, Buffer, or FormData (multipart). For FormData we encode with form-data-encoder. */
  body?: string | Buffer | FormData;
  /** When "HTTP/2", use http2 for https URLs. Otherwise use http/https. */
  httpVersion?: "HTTP/1.0" | "HTTP/1.1" | "HTTP/2";
  /** If true, allow insecure TLS (curl --insecure). */
  insecure?: boolean;
  /** Request timeout in milliseconds (best-effort; curl --max-time). */
  timeoutMs?: number;
  /** Connection timeout in milliseconds (best-effort; curl --connect-timeout). */
  connectionTimeoutMs?: number;
  /** Whether to follow redirects (default true). */
  followRedirects?: boolean;
  /** Whether to propagate Set-Cookie -> Cookie across redirect hops (default true). */
  propagateCookiesOnRedirect?: boolean;
};

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

/**
 * Perform an HTTP request via cURL (spawned), with timing instrumentation.
 */
export async function nodeHttpRequest(
  options: NodeHttpClientOptions,
): Promise<NodeHttpClientResponse> {
  const headers = { ...options.headers };
  let body: string | Buffer | undefined = undefined;

  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      const { body: encoded, contentType } = await encodeFormData(options.body);
      body = encoded;
      headers["Content-Type"] = contentType;
      headers["Content-Length"] = String(encoded.length);
    } else if (typeof options.body === "string") {
      body = options.body;
    } else {
      body = options.body;
    }
  }

  return await curlHttpRequest({
    ...options,
    headers,
    body,
  });
}
