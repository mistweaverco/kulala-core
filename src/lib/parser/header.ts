import type { KulalaError } from "./types/error";
import type { KulalaHeader } from "./types/header";

export const getHeader = (
  line: string,
  lineIdx: number,
  filepath: string | null = null,
): KulalaHeader | KulalaError => {
  const splitLine = line.split(":");
  const name = splitLine.length > 0 ? splitLine[0].trim() : "";
  let value =
    splitLine.length > 1 ? splitLine.slice(1).join(":").trim() : undefined;

  // Unescape braces if content came from JSON stdin (similar to GraphQL/JSON body handling)
  // When content is JSON-encoded, braces may be escaped as \{ and \} or \\{ and \\}
  // We need to unescape them to get the actual {{variable}} syntax
  if (value) {
    // Handle both \{ and \\{ patterns (unescape multiple times to handle double-escaping)
    value = value.replace(/\\+{/g, "{").replace(/\\+}/g, "}");
  }

  if (name === "") {
    return {
      errorMessage: `Header name is empty at line ${lineIdx + 1}${
        filepath ? ` in file ${filepath}` : ""
      }`,
      lineNumber: lineIdx,
    };
  }
  return {
    name,
    value,
  };
};
