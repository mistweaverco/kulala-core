import type { KulalaComment } from "./comment";

export type KulalaHttpMethodAvailable =
  | "DELETE"
  | "GET"
  | "GRAPHQL"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT";

export type KulalaHttpVersion = "HTTP/1.0" | "HTTP/1.1" | "HTTP/2" | "HTTP/3";

export type KulalaHttpMethodWithBody = Exclude<
  KulalaHttpMethodAvailable,
  "GET" | "HEAD" | "OPTIONS"
>;

export type KulalaHttpMethodWithoutBody = Extract<
  KulalaHttpMethodAvailable,
  "GET" | "HEAD" | "OPTIONS"
>;

export type KulalaHttpMethod =
  | KulalaHttpMethodWithBody
  | KulalaHttpMethodWithoutBody;

export type KulalaHttpScheme = "http" | "https" | "ws" | "wss";
export type KulalaHttpURL = `${KulalaHttpScheme}://${string}` | `/${string}`;

// Per specification, the request line consists of three parts:
// 1. The HTTP method (e.g., GET, POST, PUT, DELETE).
// 2. The Request-URI (Uniform Resource Identifier), which indicates the resource being requested
//    (e.g., /index.html, /api/data).
// 3. The HTTP version (e.g., HTTP/1.1, HTTP/2).
//
// These parts are separated by spaces, and the line ends with a carriage return and line feed (CRLF).
// An example of a complete HTTP request line is:
//    GET /index.html HTTP/1.1
//    POST /api/data HTTP/2
//    PUT /resource/123 HTTP/1.1
//    DELETE /item/456 HTTP/1.0
//    HEAD /status HTTP/1.1
//    OPTIONS /options HTTP/1.1
//
// The .http specification varies slightly in that you could technically omit
// the HTTP method as well as the HTTP version, but in practice, these components
// are almost always included in real-world HTTP requests.
// Plus, this parser should always return a valid HTTP request line string,
// so we enforce the presence of all three components here.
export type KulalaHttpRequestLineString =
  `${KulalaHttpMethodAvailable} ${KulalaHttpURL} ${KulalaHttpVersion}`;

// Request line can span multiple lines (e.g. URL with query params). Each part is either
// a URL continuation line or a comment, so comments can be preserved in place.
export type KulalaRequestLinePart =
  | { type: "url"; line: string }
  | { type: "comment"; comment: KulalaComment };

// Header section is an ordered array so comments between headers are preserved.
export type KulalaHeaderSectionEntry =
  | { type: "header"; name: string; value?: string }
  | { type: "comment"; comment: KulalaComment };

type KulalaRequestBody = string | object;

/** Redirect response body to a file (JetBrains >> / >>! syntax). */
export type KulalaResponseRedirect = {
  filePath: string;
  overwrite: boolean;
};

// Considering the HTTP methods, we can categorize them into two groups:
// Methods that typically do not have a body (e.g., GET, HEAD, OPTIONS).
// Methods that usually include a body (e.g., POST, PUT, DELETE, PATCH, GRAPHQL).
// This categorization allows us to define two separate types for requests:

export type KulalaRequest = {
  method: KulalaHttpMethod;
  // Resolved URL used for execution (single line, no comments).
  url: KulalaHttpURL;
  // Ordered list of headers and comments so comments are preserved in place.
  headerSection: KulalaHeaderSectionEntry[];
  // Optional: when request line spans multiple lines or has comments, for round-trip.
  requestLineParts?: KulalaRequestLinePart[];
  body?: KulalaRequestBody;
  /** When set, save response body to this file (>> = create/suffix, >>! = overwrite). */
  responseRedirect?: KulalaResponseRedirect;
};
