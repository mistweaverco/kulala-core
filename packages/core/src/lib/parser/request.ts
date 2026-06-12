import type {
  KulalaHttpMethodAvailable,
  KulalaHttpURL,
  KulalaHttpVersion,
  KulalaRequest,
  KulalaRequestLinePart,
} from "./types/request";
import type { KulalaError } from "./types/error";
import { getComment } from "./comment";
import { parseGrpcTarget } from "../grpc/parse-target";

const getValidHttpMethods = (): KulalaHttpMethodAvailable[] => [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "GRAPHQL",
  "GRPC",
  "WEBSOCKET",
];

const HTTP_VERSION = /^HTTP\/\d+(\.\d+)?$/;
const REQUEST_LINE =
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT|GRAPHQL|GRPC|WEBSOCKET) /i;

const VALID_HTTP_VERSIONS: KulalaHttpVersion[] = [
  "HTTP/1.0",
  "HTTP/1.1",
  "HTTP/2",
];

const parseHttpVersion = (s: string): KulalaHttpVersion | undefined =>
  VALID_HTTP_VERSIONS.includes(s as KulalaHttpVersion)
    ? (s as KulalaHttpVersion)
    : undefined;

/** Allow templates and arbitrary text; final URL is validated after variable substitution at request time. */
const isValidRequestTarget = (url: string): boolean => {
  const u = url.trim();
  return u.length > 0 && !/[\r\n]/.test(url);
};

/**
 * Split `METHOD`-suffix into request target and optional trailing HTTP version.
 * The target may contain spaces (e.g. `{{ API_URL }}`); version is only the final ` HTTP/x.x` token.
 */
const splitRequestTargetAndVersion = (
  afterMethod: string,
): { target: string; versionStr?: string } => {
  const m = afterMethod.match(/^(.*)\s+(HTTP\/\d+(?:\.\d+)?)$/);
  if (!m) return { target: afterMethod };
  return { target: m[1]!.trimEnd(), versionStr: m[2] };
};

// Check if a line is a request continuation (indented URL part or comment).
export const isRequestContinuationLine = (line: string): boolean =>
  line.length > 0 && /^\s/.test(line);

export const isRequestLine = (line: string): boolean => REQUEST_LINE.test(line);

/**
 * Parse request line(s).
 * Handles multi-line request with URL continuations and comments.
 * Returns [KulalaRequest, linesConsumed].
 */
export const getRequest = (
  lines: string[],
  startLineIdx: number,
): [KulalaRequest | KulalaError, number] => {
  const firstLine = lines[startLineIdx] ?? "";
  const trimmed = firstLine.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) {
    return [
      {
        errorMessage: `Missing URL at line ${startLineIdx + 1}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  const methodRaw = trimmed.slice(0, firstSpace).toUpperCase();
  const method = (
    methodRaw === "WEBSOCKET" ? "WEBSOCKET" : methodRaw
  ) as KulalaHttpMethodAvailable;
  if (!getValidHttpMethods().includes(method)) {
    return [
      {
        errorMessage: `Invalid HTTP method: ${method}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  const afterMethod = trimmed.slice(firstSpace + 1).trimStart();
  if (!afterMethod) {
    return [
      {
        errorMessage: `Missing URL at line ${startLineIdx + 1}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  if (method === "GRPC") {
    const grpcCommand = parseGrpcTarget(afterMethod);
    return [
      {
        method: "GRPC",
        url: afterMethod as KulalaHttpURL,
        grpcCommand,
        headerSection: [],
      },
      1,
    ];
  }

  if (method === "WEBSOCKET") {
    const urlToken = afterMethod.split(/\s+/)[0] ?? afterMethod;
    return [
      {
        method: "WEBSOCKET",
        url: urlToken as KulalaHttpURL,
        headerSection: [],
      },
      1,
    ];
  }

  if (HTTP_VERSION.test(afterMethod)) {
    return [
      {
        errorMessage: `Missing URL at line ${startLineIdx + 1}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  const requestLineParts: KulalaRequestLinePart[] = [];
  let urlResolved: KulalaHttpURL;
  let consumed = 1;

  const firstSplit = splitRequestTargetAndVersion(afterMethod);
  if (firstSplit.versionStr !== undefined && firstSplit.target.length > 0) {
    urlResolved = firstSplit.target as KulalaHttpURL;
    if (!isValidRequestTarget(urlResolved)) {
      return [
        {
          errorMessage: `Invalid URL: ${urlResolved}`,
          lineNumber: startLineIdx,
        },
        1,
      ];
    }
    const httpVersion = parseHttpVersion(firstSplit.versionStr);
    return [
      {
        method,
        url: urlResolved,
        ...(httpVersion !== undefined ? { httpVersion } : {}),
        headerSection: [],
      },
      1,
    ];
  }

  const firstUrlPart = firstSplit.target;
  const urlParts: string[] = [firstUrlPart];
  requestLineParts.push({ type: "url", line: firstUrlPart });
  let httpVersion: KulalaHttpVersion | undefined;
  let httpVersionInline = false;

  // Consume continuation lines (URL parts, comments, or final HTTP version line)
  while (startLineIdx + consumed < lines.length) {
    const line = lines[startLineIdx + consumed];
    if (!isRequestContinuationLine(line)) break;
    const trimmed = line.trim();
    consumed += 1;
    if (/^#/.test(trimmed) || /^\/\//.test(trimmed)) {
      requestLineParts.push({
        type: "comment",
        comment: getComment(line, startLineIdx + consumed - 1),
      });
      continue;
    }
    if (HTTP_VERSION.test(trimmed)) {
      httpVersion = parseHttpVersion(trimmed);
      break;
    }
    const contSplit = splitRequestTargetAndVersion(trimmed);
    if (contSplit.versionStr !== undefined) {
      if (contSplit.target.length > 0) {
        requestLineParts.push({ type: "url", line: contSplit.target });
        urlParts.push(contSplit.target);
        httpVersionInline = true;
      }
      httpVersion = parseHttpVersion(contSplit.versionStr);
      break;
    }
    requestLineParts.push({ type: "url", line: trimmed });
    urlParts.push(trimmed);
  }

  urlResolved = urlParts.join("") as KulalaHttpURL;
  if (!isValidRequestTarget(urlResolved)) {
    return [
      {
        errorMessage: `Invalid URL: ${urlResolved}`,
        lineNumber: startLineIdx,
      },
      consumed,
    ];
  }

  return [
    {
      method,
      url: urlResolved,
      ...(httpVersion !== undefined ? { httpVersion } : {}),
      ...(httpVersionInline ? { httpVersionInline } : {}),
      headerSection: [],
      requestLineParts:
        requestLineParts.length > 0 ? requestLineParts : undefined,
    },
    consumed,
  ];
};
