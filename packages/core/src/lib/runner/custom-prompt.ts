import { createPrompt, deleteVariable, getVariable } from "../persistence";
import type { KulalaPromptResponse } from "./types";

export type KulalaPromptInputType = "text" | "password" | "url";

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
