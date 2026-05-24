import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import {
  mergePersistedRequestVarResults,
  saveRequestVarResult,
} from "../persistence/request-var-store";
import {
  resolveRequestVariable,
  type PreviousResponse,
} from "../variables/request-vars";
import { isVscodeRestclientCompatEnabled } from "./vscode-restclient-compat";
import type { VariableResolver } from "./types";

export type RequestVarContext = {
  previousResults: Map<string, PreviousResponse>;
  resolver: VariableResolver | undefined;
};

export function createRequestVarContext(
  doc: KulalaDocument,
  block: KulalaBlock,
  stableDocId: string,
): RequestVarContext {
  const previousResults = new Map<string, PreviousResponse>();
  if (!isVscodeRestclientCompatEnabled(doc, block)) {
    return { previousResults, resolver: undefined };
  }
  mergePersistedRequestVarResults(stableDocId, previousResults);
  return {
    previousResults,
    resolver: (key: string) => resolveRequestVariable(key, previousResults),
  };
}

export function recordRequestVarResult(
  doc: KulalaDocument,
  block: KulalaBlock,
  stableDocId: string,
  resultKey: string,
  response: PreviousResponse,
  previousResults: Map<string, PreviousResponse>,
): void {
  if (!isVscodeRestclientCompatEnabled(doc, block)) return;
  previousResults.set(resultKey, response);
  saveRequestVarResult(stableDocId, resultKey, response);
}
