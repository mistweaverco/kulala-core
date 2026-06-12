import { curlArgvFromOperators, mergeCurlArgv } from "../curl/passthrough";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaOperator } from "../parser/types/operator";
import { loadDefaultCurlOptions } from "../variables/default-curl-options";

/**
 * File-header operators merged with block operators; block wins on same operator name.
 */
export function getEffectiveOperators(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
): KulalaOperator[] {
  const docOps =
    block.sourceFileHeaderOperators ?? doc?.fileHeaderOperators ?? [];
  const byName = new Map<string, KulalaOperator>();
  for (const op of docOps) byName.set(op.name, op);
  for (const op of block.operators) byName.set(op.name, op);
  return [...byName.values()];
}

/**
 * Env default curl options merged with file-header and block curl operators.
 * Request operators override project defaults on the same flag token.
 */
export function getEffectiveCurlArgv(
  doc: KulalaDocument | undefined,
  block: KulalaBlock,
  env: string,
  startDir: string,
): string[] {
  const envArgv = loadDefaultCurlOptions(env, startDir);
  const operatorArgv = curlArgvFromOperators(getEffectiveOperators(doc, block));
  return mergeCurlArgv([envArgv, operatorArgv]);
}
