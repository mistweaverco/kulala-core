import { getDocument } from "../parser/parser";
import { findBlockAtCursor } from "../runner/block";
import type { LspInlayHint, LspRange } from "./types";
import {
  formatVariablePreview,
  resolveVariableValue,
  variableReferenceAtCursor,
} from "./variable-hover";

const VAR_REF_RE = /\{\{\s*([^}]+)\s*\}\}/g;

function positionInRange(
  line0: number,
  character: number,
  range?: LspRange,
): boolean {
  if (!range) return true;
  const pos = { line: line0, character };
  const start = range.start;
  const end = range.end;
  if (pos.line < start.line || pos.line > end.line) return false;
  if (pos.line === start.line && pos.character < start.character) return false;
  if (pos.line === end.line && pos.character > end.character) return false;
  return true;
}

function unresolvedTemplate(varName: string): string {
  return `{{${varName}}}`;
}

export async function lspInlayHints(input: {
  content: string;
  filepath?: string;
  env?: string;
  range?: LspRange;
}): Promise<LspInlayHint[]> {
  const doc = await getDocument(input.content, input.filepath);
  const lines = input.content.split(/\r?\n/);
  const env = input.env ?? "default";

  const startLine0 = input.range?.start.line ?? 0;
  const endLine0 = input.range?.end.line ?? Math.max(0, lines.length - 1);

  const hints: LspInlayHint[] = [];

  for (let line0 = startLine0; line0 <= endLine0; line0++) {
    const line1 = line0 + 1;
    const line = lines[line0] ?? "";
    VAR_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VAR_REF_RE.exec(line)) !== null) {
      const varName = match[1]!.trim();
      if (varName.startsWith("_")) continue;

      const endCol0 = match.index + match[0]!.length;
      if (!positionInRange(line0, endCol0, input.range)) continue;

      // Skip when the cursor-style resolver cannot identify a reference (paranoia).
      if (!variableReferenceAtCursor(line, endCol0)) continue;

      const block = findBlockAtCursor(doc, {
        line: line1,
        column: endCol0 + 1,
      });
      const value = await resolveVariableValue(
        varName,
        doc,
        input.content,
        block ?? undefined,
        env,
      );
      const unresolved = unresolvedTemplate(varName);
      if (value === unresolved || value === "") continue;

      hints.push({
        position: { line: line0, character: endCol0 },
        label: `: ${formatVariablePreview(value)}`,
        kind: 1,
        paddingLeft: true,
        tooltip: {
          kind: "plaintext",
          value,
        },
      });
    }
  }

  return hints;
}
