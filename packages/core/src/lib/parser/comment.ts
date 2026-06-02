import type { KulalaComment } from "./types/comment";

export const getComment = (line: string, lineIdx: number): KulalaComment => {
  const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? "";
  const content = line.replace(/^\s*(?:#|\/\/)\s?/, "");
  return {
    content,
    lineNumber: lineIdx,
    ...(leadingWhitespace ? { leadingWhitespace } : {}),
  };
};
