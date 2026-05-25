import {
  buildCustomPromptResponse,
  consumeRequestPromptVariable,
  resolvePromptVariableValue,
  type KulalaPromptInputType,
} from "./custom-prompt";
import { ScriptPromptError } from "./script-prompt-error";
import { ScriptReplayError, ScriptSkipError } from "./script-control-error";

export type KulalaPromptOptions = {
  type?: KulalaPromptInputType;
};

export type KulalaScriptApi = {
  /**
   * Prompt for a request-scoped variable. Pauses the run until the user submits input
   * (same flow as `// @kulala-prompt`). On retry, returns the stored value.
   */
  prompt: (
    label: string,
    varName: string,
    opts?: KulalaPromptOptions,
  ) => string;
  request: {
    /** Skip sending this request (pre-request scripts only). */
    skip: () => void;
    /** Re-run this request from pre-request scripts (pre- and post-request). */
    replay: () => void;
  };
};

export function buildKulalaScriptApi(ctx: {
  stableDocId: string;
  blockName: string;
  mutableVars: Record<string, string>;
  phase: "preRequest" | "postRequest";
}): KulalaScriptApi {
  return {
    prompt(label: string, varName: string, opts?: KulalaPromptOptions) {
      if (typeof label !== "string" || label.trim().length === 0) {
        throw new Error("$kulala.prompt: label must be a non-empty string");
      }
      if (typeof varName !== "string" || varName.trim().length === 0) {
        throw new Error("$kulala.prompt: varName must be a non-empty string");
      }
      const name = varName.trim();
      const inputType = opts?.type ?? "text";

      const existing = resolvePromptVariableValue({
        varName: name,
        mutableVars: ctx.mutableVars,
        stableDocId: ctx.stableDocId,
        blockName: ctx.blockName,
      });
      if (existing !== undefined) {
        consumeRequestPromptVariable({
          stableDocId: ctx.stableDocId,
          blockName: ctx.blockName,
          varName: name,
          mutableVars: ctx.mutableVars,
        });
        return existing;
      }

      if (!ctx.stableDocId) {
        throw new Error(
          "$kulala.prompt: a document path is required to prompt for input",
        );
      }

      throw new ScriptPromptError(
        buildCustomPromptResponse({
          stableDocId: ctx.stableDocId,
          blockName: ctx.blockName,
          varName: name,
          label,
          inputType,
        }),
      );
    },
    request: {
      skip() {
        if (ctx.phase !== "preRequest") {
          throw new Error(
            "$kulala.request.skip() is only available in pre-request scripts",
          );
        }
        throw new ScriptSkipError();
      },
      replay() {
        throw new ScriptReplayError();
      },
    },
  };
}
