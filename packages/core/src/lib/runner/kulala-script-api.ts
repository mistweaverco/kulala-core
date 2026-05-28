import {
  buildCustomPromptResponse,
  consumeRequestPromptVariable,
  resolvePromptVariableValue,
  type KulalaPromptInputType,
} from "./custom-prompt";
import { getVariable, setVariable } from "../persistence";
import { ScriptPromptError } from "./script-prompt-error";
import { ScriptReplayError, ScriptSkipError } from "./script-control-error";

export type KulalaPromptOptions = {
  type?: KulalaPromptInputType;
};

const CLIENT_GLOBAL_HEADERS_VAR = "__kulala_client_global_headers__";

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function setHeaderCaseInsensitive(
  map: Record<string, string>,
  name: string,
  value: string | null,
): void {
  const targetLc = normalizeHeaderName(name);
  for (const k of Object.keys(map)) {
    if (normalizeHeaderName(k) === targetLc) delete map[k];
  }
  if (value !== null) {
    map[name] = value;
  }
}

function loadClientGlobalHeaders(): Record<string, string> {
  const v = getVariable("global", CLIENT_GLOBAL_HEADERS_VAR);
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === "string") out[k] = raw;
  }
  return out;
}

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
  /**
   * Client-scoped helpers.
   *
   * These are persisted across runs (unlike `client.global.headers`, which is per execution flow).
   */
  client: {
    global: {
      headers: {
        set: (headerName: string, headerValue: string) => void;
        get: (headerName: string) => string | undefined;
        clear: (headerName: string) => void;
      };
    };
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
    client: {
      global: {
        headers: {
          set(headerName: string, headerValue: string) {
            if (
              typeof headerName !== "string" ||
              headerName.trim().length === 0
            ) {
              throw new Error(
                "$kulala.client.global.headers.set: headerName must be a non-empty string",
              );
            }
            const headers = loadClientGlobalHeaders();
            setHeaderCaseInsensitive(headers, headerName, String(headerValue));
            setVariable("global", CLIENT_GLOBAL_HEADERS_VAR, headers);
          },
          get(headerName: string) {
            if (
              typeof headerName !== "string" ||
              headerName.trim().length === 0
            ) {
              throw new Error(
                "$kulala.client.global.headers.get: headerName must be a non-empty string",
              );
            }
            const lc = normalizeHeaderName(headerName);
            const headers = loadClientGlobalHeaders();
            for (const [k, v] of Object.entries(headers)) {
              if (normalizeHeaderName(k) === lc) return v;
            }
            return undefined;
          },
          clear(headerName: string) {
            if (
              typeof headerName !== "string" ||
              headerName.trim().length === 0
            ) {
              throw new Error(
                "$kulala.client.global.headers.clear: headerName must be a non-empty string",
              );
            }
            const headers = loadClientGlobalHeaders();
            setHeaderCaseInsensitive(headers, headerName, null);
            setVariable("global", CLIENT_GLOBAL_HEADERS_VAR, headers);
          },
        },
      },
    },
  };
}
