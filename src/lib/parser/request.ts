import type {
  KulalaHttpMethod,
  KulalaHttpScheme,
  KulalaHttpURL,
  KulalaHttpVersion,
  KulalaRequest,
  KulalaRequestLinePart,
} from "./types/request";
import type { KulalaError } from "./types/error";
import { getComment } from "./comment";

const getValidHttpMethods = (): KulalaHttpMethod[] => [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "GRAPHQL",
];

const HTTP_VERSION = /^HTTP\/\d+(\.\d+)?$/;

const VALID_HTTP_VERSIONS: KulalaHttpVersion[] = [
  "HTTP/1.0",
  "HTTP/1.1",
  "HTTP/2",
];

const parseHttpVersion = (s: string): KulalaHttpVersion | undefined =>
  VALID_HTTP_VERSIONS.includes(s as KulalaHttpVersion)
    ? (s as KulalaHttpVersion)
    : undefined;

const isValidUrl = (url: KulalaHttpURL): boolean => {
  const schemes: KulalaHttpScheme[] = ["http", "https", "ws", "wss"];
  const schemePattern = schemes.join("|");
  // Regex to match URLs starting with / or a valid scheme followed by ://
  const urlPattern = new RegExp(
    `^(\\/|(${schemePattern}):\\/\\/)[\\w\\-]+(\\.[\\w\\-]+)+([\\w.,@?^=%&:/~+#\\-]*[\\w@?^=%&/~+#\\-])?$`,
  );
  return urlPattern.test(url);
};

// Check if a line is a request continuation (indented URL part or comment).
export const isRequestContinuationLine = (line: string): boolean =>
  line.length > 0 && /^\s/.test(line);

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
  const tokens = firstLine.trim().split(/\s+/);
  const method = tokens[0] as KulalaHttpMethod;
  if (!getValidHttpMethods().includes(method)) {
    return [
      {
        errorMessage: `Invalid HTTP method: ${method}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  const requestLineParts: KulalaRequestLinePart[] = [];
  let urlResolved: KulalaHttpURL;
  let consumed = 1;

  // Single-line: METHOD url HTTP/1.1
  if (tokens.length >= 3 && HTTP_VERSION.test(tokens[2])) {
    urlResolved = tokens[1] as KulalaHttpURL;
    if (!isValidUrl(urlResolved)) {
      return [
        {
          errorMessage: `Invalid URL: ${urlResolved}`,
          lineNumber: startLineIdx,
        },
        1,
      ];
    }
    const httpVersion = parseHttpVersion(tokens[2]);
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

  // First line is METHOD url (no version yet) or METHOD only
  const firstUrlPart = tokens[1];
  if (!firstUrlPart) {
    return [
      {
        errorMessage: `Missing URL at line ${startLineIdx + 1}`,
        lineNumber: startLineIdx,
      },
      1,
    ];
  }

  const urlParts: string[] = [firstUrlPart];
  requestLineParts.push({ type: "url", line: firstUrlPart });
  let httpVersion: KulalaHttpVersion | undefined;

  // Consume continuation lines (URL parts, comments, or final HTTP version line)
  while (startLineIdx + consumed < lines.length) {
    const line = lines[startLineIdx + consumed];
    if (!isRequestContinuationLine(line)) break;
    const trimmed = line.trim();
    consumed += 1;
    if (trimmed.startsWith("# ")) {
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
    requestLineParts.push({ type: "url", line: trimmed });
    urlParts.push(trimmed);
  }

  urlResolved = urlParts.join("") as KulalaHttpURL;
  if (!isValidUrl(urlResolved)) {
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
      headerSection: [],
      requestLineParts:
        requestLineParts.length > 0 ? requestLineParts : undefined,
    },
    consumed,
  ];
};
