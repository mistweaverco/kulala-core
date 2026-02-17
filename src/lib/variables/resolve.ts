import { dirname } from "path";
import { getVariables } from "../persistence";
import { findKubaYamlDir, getKubaEnv } from "./kuba";

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
 * Resolve all variables for a request: kuba (if kuba.yaml found), then persistence
 * (global -> document -> request). Later sources override earlier.
 * Returns a flat Record<string, string> for substitution.
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
    const kubaVars = getKubaEnv(env, kubaDir);
    if (kubaVars) {
      for (const [k, v] of Object.entries(kubaVars)) {
        out[k] = v;
      }
    }
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

  return out;
}
