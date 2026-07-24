/** True for `# …` / `// …` comment lines (not `###` request separators). */
export function isHttpCommentLine(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("###")) return false;
  return t.startsWith("#") || t.startsWith("//");
}

/**
 * Peel trailing `#` / `//` comment lines (and blank lines that only pad them)
 * off the end of a request body so they are not treated as payload.
 */
export function splitTrailingCommentLines(content: string): {
  body: string;
  trailingCommentLines: string[];
} {
  if (!content) {
    return { body: "", trailingCommentLines: [] };
  }

  const lines = content.split("\n");
  const trailingCommentLines: string[] = [];

  while (lines.length > 0) {
    const last = lines[lines.length - 1]!;
    if (isHttpCommentLine(last)) {
      trailingCommentLines.unshift(lines.pop()!);
      continue;
    }
    // Drop blank lines that only separate the body from trailing comments.
    if (last.trim() === "" && trailingCommentLines.length > 0) {
      lines.pop();
      continue;
    }
    break;
  }

  return {
    body: lines.join("\n").replace(/\s+$/g, ""),
    trailingCommentLines,
  };
}
