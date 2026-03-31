import { getVariables } from "../persistence";
import { loadEnvVars } from "./env-files";
import { findKubaYamlDir, getKubaEnv } from "./kuba";
import { getMagicVariables } from "./magic";

/**
 * Coerce a variable value to string for substitution.
 */
function toString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Resolve all variables for a request.
 * Order (later overrides earlier): kuba → system/env files (http-client.env.json, .env) →
 * persistence (global → document → request) → magic variables ($uuid, $timestamp, etc.).
 * See https://neovim.getkulala.net/docs/usage/magic-variables and
 * https://neovim.getkulala.net/docs/usage/dotenv-and-http-client.env.json-support
 */
export async function resolveVariables(
  env: string,
  stableDocId: string,
  blockName: string,
  startDir: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const kubaDir = findKubaYamlDir(startDir);
  if (kubaDir !== null) {
    const kubaVars = await getKubaEnv(env, kubaDir);
    if (kubaVars) {
      for (const [k, v] of Object.entries(kubaVars)) {
        out[k] = v;
      }
    }
  }

  const envVars = loadEnvVars(env, startDir);
  for (const [k, v] of Object.entries(envVars)) {
    out[k] = v;
  }

  const globalVars = getVariables("global");
  for (const [k, v] of Object.entries(globalVars)) {
    out[k] = toString(v);
  }

  const docVars = getVariables("document", { document: stableDocId });
  for (const [k, v] of Object.entries(docVars)) {
    out[k] = toString(v);
  }

  const requestVars = getVariables("request", {
    document: stableDocId,
    blockName,
  });
  for (const [k, v] of Object.entries(requestVars)) {
    out[k] = toString(v);
  }

  const magic = getMagicVariables();
  for (const [k, v] of Object.entries(magic)) {
    out[k] = v;
  }

  return out;
}
