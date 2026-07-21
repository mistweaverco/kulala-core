import { readFile } from "fs/promises";
import { join, dirname, isAbsolute } from "path";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaDocument } from "../parser/types";
import { parseGraphQLContent } from "../parser/graphql-content";
import { isRequestContinuationLine, isRequestLine } from "../parser/request";
import { findBlocksAtCursor } from "../runner/block";

export type GraphQLBlockCursorContext = {
  block: KulalaBlock;
  /** GraphQL query text used for completions (operation body only). */
  query: string;
  /** 1-based line in `query` matching the cursor line inside the block body. */
  queryLine: number;
  /** 1-based column within the query line. */
  queryColumn: number;
};

function sliceBlockLines(
  content: string,
  block: KulalaBlock,
  directiveLinesRemoved: number,
): string[] {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, block.position.start + directiveLinesRemoved - 1);
  const end = Math.max(start, block.position.end + directiveLinesRemoved - 1);
  return lines.slice(start, end + 1);
}

type GraphQLBodySlice = {
  /** Index in blockLines of the first GraphQL query line. */
  bodyStartIdx: number;
  /** Index in blockLines of the last GraphQL query line (before variables JSON). */
  queryEndIdx: number;
  queryLines: string[];
};

/**
 * Skip preamble (### name, comments, pre-request scripts, …), the request line,
 * and headers; return GraphQL query lines only.
 *
 * Preamble must be skipped by finding a real request line - a naive
 * "first non-empty line with a space" match treats `# comments` and
 * `< ./pre-request.js` as the request and then treats the real GRAPHQL
 * line as the query body (wrong completions).
 */
async function sliceGraphQLQueryLines(
  blockLines: string[],
  filepath: string | undefined,
): Promise<GraphQLBodySlice | null> {
  let i = 0;
  while (i < blockLines.length && !isRequestLine(blockLines[i] ?? "")) {
    i++;
  }
  if (i >= blockLines.length) return null;
  i++; // skip METHOD URL [HTTP/x.x]
  while (
    i < blockLines.length &&
    isRequestContinuationLine(blockLines[i] ?? "")
  ) {
    i++;
  }

  while (i < blockLines.length) {
    const line = blockLines[i] ?? "";
    if (line.trim() === "") {
      i++;
      break;
    }
    if (/^[\w-]+:\s*/.test(line) || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    break;
  }

  const bodyStartIdx = i;
  const queryLines: string[] = [];

  for (; i < blockLines.length; i++) {
    const line = blockLines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === "" && queryLines.length > 0) {
      const rest = blockLines
        .slice(i + 1)
        .join("\n")
        .trim();
      if (rest.startsWith("{") || rest.startsWith("[")) {
        return {
          bodyStartIdx,
          queryEndIdx: i - 1,
          queryLines,
        };
      }
    }

    if (trimmed.startsWith("<")) {
      const m = trimmed.match(/^<\s*(\S+)/);
      if (!m) return null;
      const ref = m[1]!.replace(/^\.\//, "");
      const base = filepath ? dirname(filepath) : process.cwd();
      const path = isAbsolute(ref) ? ref : join(base, ref);
      try {
        const fileContent = await readFile(path, "utf8");
        const parsed = parseGraphQLContent(fileContent);
        if (parsed.query) {
          for (const ql of parsed.query.split(/\r?\n/)) {
            queryLines.push(ql);
          }
        }
      } catch {
        return null;
      }
      continue;
    }

    queryLines.push(line);
  }

  if (queryLines.length === 0) return null;
  return {
    bodyStartIdx,
    queryEndIdx: bodyStartIdx + queryLines.length - 1,
    queryLines,
  };
}

async function resolveGraphQLBodyText(
  blockLines: string[],
  filepath: string | undefined,
): Promise<string | null> {
  const slice = await sliceGraphQLQueryLines(blockLines, filepath);
  if (!slice) return null;
  const bodyText = slice.queryLines.join("\n").trim();
  if (!bodyText) return null;
  return parseGraphQLContent(bodyText).query || null;
}

async function graphQLBodyFileLines(
  blockLines: string[],
  blockStartFileLine1: number,
  filepath: string | undefined,
): Promise<{ bodyStartLine1: number; queryEndLine1: number } | null> {
  const slice = await sliceGraphQLQueryLines(blockLines, filepath);
  if (!slice) return null;
  return {
    bodyStartLine1: blockStartFileLine1 + slice.bodyStartIdx,
    queryEndLine1: blockStartFileLine1 + slice.queryEndIdx,
  };
}

export async function graphQLBlockCursorContext(
  doc: KulalaDocument,
  input: {
    content: string;
    filepath?: string;
    line: number;
    column: number;
  },
): Promise<GraphQLBlockCursorContext | null> {
  const blocks = findBlocksAtCursor(doc, {
    line: input.line,
    column: input.column,
  });
  const block = blocks[0];
  if (!block || block.request.method !== "GRAPHQL") return null;

  const directiveLinesRemoved = doc.directiveLinesRemoved ?? 0;
  const blockLines = sliceBlockLines(
    input.content,
    block,
    directiveLinesRemoved,
  );
  const blockStartFileLine1 = block.position.start + directiveLinesRemoved;

  const fileLines = await graphQLBodyFileLines(
    blockLines,
    blockStartFileLine1,
    input.filepath,
  );
  if (!fileLines) return null;

  const { bodyStartLine1, queryEndLine1 } = fileLines;
  if (input.line < bodyStartLine1 || input.line > queryEndLine1) return null;

  const query = await resolveGraphQLBodyText(blockLines, input.filepath);
  if (!query) return null;

  const queryLine = input.line - bodyStartLine1 + 1;
  const queryColumn = input.column;

  return {
    block,
    query,
    queryLine,
    queryColumn,
  };
}
