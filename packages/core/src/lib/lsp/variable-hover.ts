import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { createRequestVarContext } from "../runner/request-var-context";
import { findBlocksAtCursor } from "../runner/block";
import { getDocument } from "../parser/parser";
import {
  getStableDocumentId,
  resolveVariableReference,
  resolveVariables,
} from "../variables";
import { substituteInString } from "../variables/substitute";
import type { LspHover } from "./types";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function lineAt(content: string, line1: number): string {
  const lines = content.split(/\r?\n/);
  return lines[Math.max(0, line1 - 1)] ?? "";
}

/** Return the variable reference name when `column1` (1-based) is inside `{{ ... }}`. */
export function variableReferenceAtCursor(
  line: string,
  column1: number,
): string | null {
  const col0 = clamp(column1 - 1, 0, line.length);
  const re = /\{\{\s*([^}]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0]!.length;
    if (col0 >= start && col0 < end) {
      return match[1]!.trim();
    }
  }
  return null;
}

async function resolveVariableHoverValue(
  varName: string,
  doc: KulalaDocument,
  content: string,
  block: KulalaBlock | undefined,
  env: string,
): Promise<string> {
  const stableDocId = getStableDocumentId(doc.filepath, content);
  const pathMod = await import("path");
  const startDir = doc.filepath ? pathMod.dirname(doc.filepath) : process.cwd();
  const activeBlock = block ?? doc.blocks[0];
  const vars = await resolveVariables(
    env,
    stableDocId,
    activeBlock?.name ?? "",
    startDir,
    {
      fileHeader:
        activeBlock?.sourceFileHeaderVariables ??
        doc.fileHeaderVariables ??
        undefined,
      blockPreamble: activeBlock?.preambleVariables,
    },
  );
  const { resolver } = createRequestVarContext(
    doc,
    activeBlock ?? doc.blocks[0]!,
    stableDocId,
  );

  const fromVars = resolveVariableReference(varName, vars);
  if (fromVars !== undefined) return fromVars;
  if (resolver) {
    const fromRequest = resolver(varName);
    if (fromRequest !== undefined) return fromRequest;
  }

  const template = `{{${varName}}}`;
  const substituted = substituteInString(template, vars, resolver);
  if (substituted !== template && substituted !== "") return substituted;

  return template;
}

export async function lspVariableHover(input: {
  content: string;
  filepath?: string;
  env?: string;
  line: number;
  column: number;
}): Promise<LspHover | null> {
  const line = lineAt(input.content, input.line);
  const varName = variableReferenceAtCursor(line, input.column);
  if (!varName) return null;

  const doc = await getDocument(input.content, input.filepath);
  const blocks = findBlocksAtCursor(doc, {
    line: input.line,
    column: input.column,
  });

  const value = await resolveVariableHoverValue(
    varName,
    doc,
    input.content,
    blocks[0],
    input.env ?? "default",
  );

  return {
    contents: {
      kind: "plaintext",
      value,
    },
  };
}
