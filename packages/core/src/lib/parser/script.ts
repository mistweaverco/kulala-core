import { dirname, relative, resolve } from "path";
import type { KulalaError } from "./types/error";
import type { KulalaScript } from "./types/script";

/** `< {%` / `> {%` (JetBrains); `< \{%` is still accepted for older files. */
const inlineScriptRegexStart = /[<>]\s+(?:\\)?\{%/;
/** JetBrains HTTP client uses `%}`; older builds also matched `%\}` (escaped brace). */
function indexOfInlineScriptEnd(contents: string): number {
  const legacy = contents.indexOf("%\\}");
  const standard = contents.indexOf("%}");
  if (legacy === -1) return standard;
  if (standard === -1) return legacy;
  return Math.min(legacy, standard);
}
export const preRequestScriptMarker = "< ";
export const postRequestScriptMarker = "> ";

export const isPreRequestScriptLine = (line: string): boolean =>
  line.startsWith(preRequestScriptMarker);

/** Lines consumed by an inline `{% ... %}` script (including the opening and closing lines). */
export function getInlineScriptConsumedLineCount(
  line: string,
  blockLines: string[],
  lineIdx: number,
): number {
  if (!inlineScriptRegexStart.test(line)) return 1;
  const contents = blockLines.slice(lineIdx).join("\n");
  const closingStart = indexOfInlineScriptEnd(contents);
  if (closingStart === -1) return 1;
  const cand3 = contents.slice(closingStart, closingStart + 3);
  const closeLen = cand3 === "%\\}" ? 3 : 2;
  const prefix = contents.slice(0, closingStart + closeLen);
  return prefix.split("\n").length;
}

export const getScript = async (
  line: string,
  blockLines: string[],
  lineIdx: number,
  filepath?: string,
): Promise<KulalaScript | KulalaError> => {
  const type = line.startsWith(preRequestScriptMarker)
    ? "preRequest"
    : "postRequest";
  const marker =
    type === "preRequest" ? preRequestScriptMarker : postRequestScriptMarker;
  const langRegex = /lang=(ts|js|lua)/;
  const langMatch = line.match(langRegex);
  const langTest = langMatch ? langMatch[1] : null;
  const lang = langMatch ? (langMatch[1] as "ts" | "js" | "lua") : "js";
  // Get the script content by joining all lines from
  // lineIdx to the end of the block
  // and removing the leading "> {%" or "< {%" with optional
  //" lang=js/ts and trailing " %>"
  const removeLang = langTest ? ` lang=${langTest}` : "";
  const contents = blockLines.slice(lineIdx).join("\n");
  const isInlineScript = inlineScriptRegexStart.test(line);
  const closingTag = indexOfInlineScriptEnd(contents);
  let content = "";
  if (isInlineScript) {
    content = contents
      .slice(
        line.indexOf(`{%${removeLang}`) + removeLang.length + 2,
        closingTag,
      )
      .trim()
      .replaceAll("\\{", "{")
      .replaceAll("\\}", "}");
  } else {
    if (!filepath) {
      return {
        errorMessage: `Cannot resolve external script path without a base filepath`,
        lineNumber: lineIdx,
        filepath,
      };
    }
    const scriptFilePath = line.slice(line.indexOf(marker) + marker.length);
    const scriptFileDir = dirname(filepath);
    const resolvedPath = resolve(scriptFileDir, scriptFilePath);
    filepath = relative(process.cwd(), resolvedPath);
    content = await Bun.file(resolvedPath).text();
  }
  if (content === "") {
    return {
      errorMessage: `Empty ${type} script`,
      lineNumber: lineIdx,
      filepath,
    };
  }
  const source = isInlineScript ? ("inline" as const) : ("file" as const);
  return {
    type,
    lang,
    source,
    content,
    filepath,
    lineNumber: lineIdx,
  };
};
