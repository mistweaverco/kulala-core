/** Parsed curl command (HTTP Client import shape). */
export type CurlParsedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookie: string;
  body: string[];
  httpVersion: string;
};

/** HTTP file fragment produced from curl (for paste into .http). */
export type CurlHttpSpec = {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookie: string;
  bodyLines: string[];
  httpVersion: string;
};

export type CurlFormatInput = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  httpVersion?: string;
  insecure?: boolean;
  /** Default kulala-core user agent when not set in headers. */
  userAgent?: string;
  verbose?: boolean;
  silent?: boolean;
};
