import type { KulalaError } from "./types/error";
import { postRequestScriptMarker } from "./script";
import type {
  KulalaRequestBody,
  KulalaRequestBodyType,
  KulalaRequestFileBody,
  KulalaRequestGraphQLBody,
} from "./types/body";

export const isBody = (obj: unknown): obj is KulalaRequestBody => {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const body = obj as KulalaRequestBody;
  if (!("type" in body) || !("content" in body)) {
    return false;
  }
  const validTypes: KulalaRequestBodyType[] = [
    "json",
    "form",
    "file",
    "raw",
    "graphql",
  ];
  if (!validTypes.includes(body.type)) {
    return false;
  }
  switch (body.type) {
    case "json":
      return typeof body.content === "string";
    case "form":
      return (
        typeof body.content === "object" &&
        body.content !== null &&
        !Array.isArray(body.content)
      );
    case "file":
      return (
        typeof body.content === "object" &&
        body.content !== null &&
        "filePath" in body.content &&
        typeof (body.content as KulalaRequestFileBody).filePath === "string"
      );
    case "raw":
      return typeof body.content === "string";
    case "graphql":
      return (
        typeof body.content === "object" &&
        body.content !== null &&
        "query" in body.content &&
        typeof (body.content as KulalaRequestGraphQLBody).query === "string"
      );
    default:
      return false;
  }
};

export const getBody = async (
  blockLines: string[],
  lineIdx: number,
  method?: string,
): Promise<KulalaRequestBody | KulalaError> => {
  // fetch everything after lineIdx
  // until the end or up to the postRequestScriptMarker
  const contents = blockLines.slice(lineIdx).join("\n");
  const postRequestScriptMarkerPos = contents.indexOf(postRequestScriptMarker);
  const content =
    postRequestScriptMarkerPos !== -1
      ? contents.slice(0, postRequestScriptMarkerPos).trim()
      : contents.trim();

  // GraphQL requests: query as plain text, optional variables JSON after blank line
  // Format per https://neovim.getkulala.net/docs/usage/graphql
  if (method === "GRAPHQL") {
    // Split by double newline (blank line) to separate query and variables
    const parts = content
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const query = parts[0] ?? "";
    let variables: Record<string, unknown> | undefined = undefined;

    // If there's a second part, try to parse it as JSON for variables
    if (parts.length > 1) {
      try {
        const jsonStr = parts[1]!
          .replace(/\\\{/g, "{")
          .replace(/\\\}/g, "}")
          .replace(/,(\s*[}\]])/g, "$1");
        const parsed = JSON.parse(jsonStr) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !Array.isArray(parsed)
        ) {
          variables = parsed as Record<string, unknown>;
        }
      } catch (_) {
        // If variables JSON parsing fails, ignore variables
      }
    }

    return {
      type: "graphql",
      content: {
        query,
        ...(variables !== undefined ? { variables } : {}),
      },
    };
  }

  // Regular JSON body
  try {
    // Allow trailing commas (strip comma before } or ])
    const jsonStr = content
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}")
      .replace(/,(\s*[}\]])/g, "$1");
    return {
      type: "json",
      content: JSON.parse(jsonStr),
    };
  } catch (_) {
    console.warn(
      `Failed to parse body as JSON, treating as raw text. Error: ${_}`,
    );
  }

  return {
    type: "raw",
    content: content,
  };
};
