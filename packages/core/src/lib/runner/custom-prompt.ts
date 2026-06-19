import { createPrompt, deleteVariable, getVariable } from "../persistence";
import type { KulalaPromptResponse } from "./types";

export type KulalaPromptInputType = "text" | "password" | "url";

const PROMPT_INPUT_TYPES = new Set<KulalaPromptInputType>([
  "text",
  "password",
  "url",
]);

const PROMPT_TYPE_SUFFIX_RE = /\s+\{\s*type\s*:\s*["']([^"']+)["']\s*\}\s*$/i;

export type ParsedKulalaPromptOperatorArgs = {
  varName: string;
  label?: string;
  inputType?: KulalaPromptInputType;
};

function stripPromptTypeSuffix(raw: string): {
  rest: string;
  inputType?: KulalaPromptInputType;
} {
  const match = raw.match(PROMPT_TYPE_SUFFIX_RE);
  if (!match || match.index === undefined) {
    return { rest: raw };
  }

  const candidate = match[1]!.toLowerCase();
  const inputType = PROMPT_INPUT_TYPES.has(candidate as KulalaPromptInputType)
    ? (candidate as KulalaPromptInputType)
    : undefined;

  return { rest: raw.slice(0, match.index).trimEnd(), inputType };
}

export function parseKulalaPromptOperatorArgs(
  raw: string,
): ParsedKulalaPromptOperatorArgs | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const { rest, inputType } = stripPromptTypeSuffix(trimmed);
  const s = rest;

  // Back-compat: "@prompt NAME"
  if (!s.startsWith(`"`) && !s.startsWith(`'`)) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { varName: parts[0]!, inputType };
    if (parts.length >= 2) {
      const varName = parts[parts.length - 1]!;
      const label = parts.slice(0, -1).join(" ");
      return { varName, label, inputType };
    }
    return null;
  }

  // Quoted label: @"What is your name?" NAME
  const quote = s[0]!;
  let i = 1;
  let label = "";
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\") {
      const next = s[i + 1];
      if (next !== undefined) {
        label += next;
        i += 2;
        continue;
      }
    }
    if (ch === quote) break;
    label += ch;
    i += 1;
  }
  if (i >= s.length || s[i] !== quote) return null;
  const afterLabel = s.slice(i + 1).trim();
  const varName = afterLabel.split(/\s+/).filter(Boolean)[0];
  if (!varName) return null;
  return { varName, label, inputType };
}

export type CustomPromptContext = {
  promptType: "custom";
  stableDocId: string;
  blockName: string;
  varName: string;
  label?: string;
  inputType?: KulalaPromptInputType;
};

export function buildCustomPromptResponse(
  ctx: Omit<CustomPromptContext, "promptType">,
): KulalaPromptResponse {
  const context: CustomPromptContext = { promptType: "custom", ...ctx };
  const promptId = createPrompt("custom", context);
  const inputType = ctx.inputType ?? "text";
  return {
    success: false,
    prompt: true,
    promptId,
    promptType: "custom",
    message: `Input required for variable: ${ctx.varName}`,
    inputs: [
      {
        id: ctx.varName,
        label: ctx.label?.trim() || ctx.varName,
        type: inputType,
        required: true,
      },
    ],
  };
}

/** Single-use: drop persisted request var once it is present in the run's variable map. */
export function consumeRequestPromptVariable(args: {
  stableDocId: string;
  blockName: string;
  varName: string;
  mutableVars: Record<string, string>;
}): void {
  const { stableDocId, blockName, varName, mutableVars } = args;
  if (stableDocId && varName && mutableVars[varName] !== undefined) {
    deleteVariable("request", varName, {
      document: stableDocId,
      blockName,
    });
  }
}

export function resolvePromptVariableValue(args: {
  varName: string;
  mutableVars: Record<string, string>;
  stableDocId: string;
  blockName: string;
}): string | undefined {
  const { varName, mutableVars, stableDocId, blockName } = args;
  if (mutableVars[varName] !== undefined) {
    return String(mutableVars[varName]);
  }
  const fromRequest = getVariable("request", varName, {
    document: stableDocId,
    blockName,
  });
  if (fromRequest === undefined) return undefined;
  const value =
    typeof fromRequest === "string" ? fromRequest : String(fromRequest);
  mutableVars[varName] = value;
  return value;
}
