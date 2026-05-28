import { parseGraphQLContent } from "./graphql-content";
import type { KulalaError } from "./types/error";
import { postRequestScriptMarker } from "./script";
import type {
  KulalaRequestBody,
  KulalaRequestBodyFromFileContent,
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
    "bodyFromFile",
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
    case "bodyFromFile":
      return (
        typeof body.content === "object" &&
        body.content !== null &&
        "__bodyFromFile" in body.content &&
        typeof (body.content as KulalaRequestBodyFromFileContent)
          .__bodyFromFile === "string"
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
  let content =
    postRequestScriptMarkerPos !== -1
      ? contents.slice(0, postRequestScriptMarkerPos).trim()
      : contents.trim();
  // Strip trailing response-redirect (>> / >>!) and post-request script (> path) lines so they are not parsed as body.
  // Use \s* at end so we match when content has trailing newline; match any line starting with > or >> so we never leave a stray ">".
  content = content.replace(/\n\s*>{1,2}!?[^\n]*\s*$/, "").trim();

  // Body from file: first line is "< path" (JetBrains HTTP syntax)
  const firstLine = blockLines[lineIdx]?.trim() ?? "";
  const fileRefMatch = firstLine.match(/^<\s+(.+)$/);
  if (fileRefMatch) {
    let path = fileRefMatch[1]!.trim();
    if (
      (path.startsWith('"') && path.endsWith('"')) ||
      (path.startsWith("'") && path.endsWith("'"))
    ) {
      path = path.slice(1, -1);
    }
    const firstNewline = content.indexOf("\n");
    const trailingAfterFileRef =
      firstNewline === -1 ? "" : content.slice(firstNewline + 1).trim();
    const bodyFromFile: KulalaRequestBodyFromFileContent = {
      __bodyFromFile: path,
    };
    if (method === "GRAPHQL" && trailingAfterFileRef) {
      bodyFromFile.__graphqlVariablesSuffix = trailingAfterFileRef;
    }
    return {
      type: "bodyFromFile",
      content: bodyFromFile,
    };
  }

  // GraphQL requests: query as plain text, optional variables JSON after blank line
  // Format per https://neovim.getkulala.net/docs/usage/graphql
  if (method === "GRAPHQL") {
    return {
      type: "graphql",
      content: parseGraphQLContent(content),
    };
  }

  if (content !== "") {
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
    } catch {
      // do nothing, we'll treat it as raw text body below
    }
  }

  return {
    type: "raw",
    content: content,
  };
};
