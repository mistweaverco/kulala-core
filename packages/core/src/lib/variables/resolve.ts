import { getVariables } from "../persistence";
import { loadEnvVars } from "./env-files";
import { findKubaYamlDir, getKubaEnv } from "./kuba";
import { getMagicVariables } from "./magic";
import { mergeVariableIntoFlat } from "./variable-lookup";

export type HttpFileVariableSources = {
  /** @name=value lines before the first ### in the .http file (or imported file). */
  fileHeader?: Record<string, string>;
  /** @name=value lines in the current block preamble before the request line. */
  blockPreamble?: Record<string, string>;
};

/**
 * Resolve all variables for a request.
 * kuba is put into $env.VAR, since kuba when run on its own
 * injects env vars into the process environment.
 *
 * Order (later overrides earlier): @-lines from .http (file header + block preamble) →
 * system/env files (http-client.env.json, .env) → persistence (global → document → request) →
 * magic variables ($uuid, $timestamp, etc.).
 * See https://neovim.getkulala.net/docs/usage/magic-variables and
 * https://neovim.getkulala.net/docs/usage/dotenv-and-http-client.env.json-support
 */
export async function resolveVariables(
  env: string,
  stableDocId: string,
  blockName: string,
  startDir: string,
  httpFileVars?: HttpFileVariableSources,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const kubaDir = findKubaYamlDir(startDir);
  if (kubaDir !== null) {
    const kubaVars = await getKubaEnv(env, kubaDir);
    if (kubaVars) {
      for (const [k, v] of Object.entries(kubaVars)) {
        out["$env." + k] = v;
      }
    }
  }

  if (httpFileVars?.fileHeader) {
    for (const [k, v] of Object.entries(httpFileVars.fileHeader)) {
      out[k] = v;
    }
  }
  if (httpFileVars?.blockPreamble) {
    for (const [k, v] of Object.entries(httpFileVars.blockPreamble)) {
      out[k] = v;
    }
  }

  const envVars = loadEnvVars(env, startDir);
  for (const [k, v] of Object.entries(envVars)) {
    out[k] = v;
  }

  const globalVars = getVariables("global");
  for (const [k, v] of Object.entries(globalVars)) {
    mergeVariableIntoFlat(k, v, out);
  }

  const docVars = getVariables("document", { document: stableDocId });
  for (const [k, v] of Object.entries(docVars)) {
    mergeVariableIntoFlat(k, v, out);
  }

  const requestVars = getVariables("request", {
    document: stableDocId,
    blockName,
  });
  for (const [k, v] of Object.entries(requestVars)) {
    mergeVariableIntoFlat(k, v, out);
  }

  const magic = getMagicVariables();
  for (const [k, v] of Object.entries(magic)) {
    out[k] = v;
  }

  return out;
}
