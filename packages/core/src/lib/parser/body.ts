import { parseGraphQLContent } from "./graphql-content";
import type { KulalaError } from "./types/error";
import { splitTrailingCommentLines } from "./comment-line";
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

export type KulalaBodyParseResult = KulalaRequestBody & {
  /** `#` / `//` lines that followed the payload inside this block. */
  trailingCommentLines?: string[];
  /** Number of lines from `lineIdx` consumed (payload + trailing comments, not scripts). */
  consumedLines: number;
};

function findBodyRegionEnd(blockLines: string[], startIdx: number): number {
  for (let i = startIdx; i < blockLines.length; i++) {
    const line = blockLines[i]!;
    // Post-request scripts and response redirects are handled by the block parser.
    if (line.startsWith("> ") || line.startsWith(">>")) {
      return i;
    }
  }
  return blockLines.length;
}

export const getBody = async (
  blockLines: string[],
  lineIdx: number,
  method?: string,
): Promise<KulalaBodyParseResult | KulalaError> => {
  const regionEnd = findBodyRegionEnd(blockLines, lineIdx);
  const consumedLines = Math.max(1, regionEnd - lineIdx);
  let content = blockLines.slice(lineIdx, regionEnd).join("\n").trim();

  // Commented-out requests after a real body must not be treated as payload (format would drop them).
  const { body: payload, trailingCommentLines } =
    splitTrailingCommentLines(content);
  content = payload;
  const trailing =
    trailingCommentLines.length > 0 ? { trailingCommentLines } : {};

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
    // Variables suffix may itself include trailing comments; peel those too.
    const {
      body: variablesSuffix,
      trailingCommentLines: fileTrailingComments,
    } = splitTrailingCommentLines(trailingAfterFileRef);
    const bodyFromFile: KulalaRequestBodyFromFileContent = {
      __bodyFromFile: path,
    };
    if (method === "GRAPHQL" && variablesSuffix) {
      bodyFromFile.__graphqlVariablesSuffix = variablesSuffix;
    }
    const fileTrailing =
      fileTrailingComments.length > 0
        ? { trailingCommentLines: fileTrailingComments }
        : trailing;
    return {
      type: "bodyFromFile",
      content: bodyFromFile,
      sourceText: content,
      consumedLines,
      ...fileTrailing,
    };
  }

  // GraphQL requests: query as plain text, optional variables JSON after blank line
  // Format per https://kulala.app/usage/graphql
  if (method === "GRAPHQL") {
    return {
      type: "graphql",
      content: parseGraphQLContent(content),
      sourceText: content,
      consumedLines,
      ...trailing,
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
        sourceText: content,
        consumedLines,
        ...trailing,
      };
    } catch {
      // do nothing, we'll treat it as raw text body below
    }
  }

  return {
    type: "raw",
    content: content,
    sourceText: content,
    consumedLines,
    ...trailing,
  };
};
