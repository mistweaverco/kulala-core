import { getComment } from "./comment";
import { isHttpCommentLine } from "./comment-line";
import { isKnownOperatorLine } from "./operator";
import { isRequestLine } from "./request";
import { isPreRequestScriptLine } from "./script";
import type { KulalaComment } from "./types/comment";

/** Plain `#` / `//` comments before the first request or `###` block marker. */
export function extractFileHeaderComments(content: string): KulalaComment[] {
  const out: KulalaComment[] = [];
  let lineIdx = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (
      t.startsWith("###") ||
      isRequestLine(line) ||
      isPreRequestScriptLine(line)
    ) {
      break;
    }
    // Known `# @name` / `# @kulala-…` operators are handled separately.
    // Commented-out `@VAR = value` lines look similar (`# @CARD_CODE = …`) but must be kept.
    if (isKnownOperatorLine(line)) {
      lineIdx++;
      continue;
    }
    if (isHttpCommentLine(line)) {
      out.push(getComment(line, lineIdx));
    }
    lineIdx++;
  }
  return out;
}
