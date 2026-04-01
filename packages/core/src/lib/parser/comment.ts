import type { KulalaComment } from "./types/comment";

export const getComment = (line: string, lineIdx: number): KulalaComment => {
  // replace all leading comment markers (# or //) and whitespace to get the content
  return {
    content: line.replace(/^(?:#|\/\/)\s?/, ""),
    lineNumber: lineIdx,
  };
};
