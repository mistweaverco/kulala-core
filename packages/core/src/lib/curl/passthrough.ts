import type { KulalaOperator } from "../parser/types/operator";

const KULALA_CURL_PREFIX = "kulala-curl-";
const KULALA_CURL_LONG_PREFIX = "kulala-curl--";

export function isKulalaCurlPassthroughOperator(name: string): boolean {
  return curlPassthroughFlagKey(name) !== undefined;
}

/** Stable key for merge/override (`--foo` or `-n`). */
export function curlPassthroughFlagKey(
  operatorName: string,
): string | undefined {
  if (operatorName.startsWith(KULALA_CURL_LONG_PREFIX)) {
    const rest = operatorName.slice(KULALA_CURL_LONG_PREFIX.length);
    return rest ? `--${rest}` : undefined;
  }
  if (operatorName.startsWith(KULALA_CURL_PREFIX)) {
    const rest = operatorName.slice(KULALA_CURL_PREFIX.length);
    // Short form: single-letter curl flags only (`kulala-curl-n` → `-n`).
    return rest.length === 1 ? `-${rest}` : undefined;
  }
  return undefined;
}

/** Tokenize operator args (supports quoted strings). */
export function splitCurlOperatorArgs(raw: string | undefined): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

export function kulalaCurlOperatorToArgv(op: KulalaOperator): string[] {
  const flag = curlPassthroughFlagKey(op.name);
  if (!flag) return [];
  return [
    flag,
    ...splitCurlOperatorArgs(op.args != null ? String(op.args) : undefined),
  ];
}

/** Later operators override earlier ones when they map to the same curl flag. */
export function mergeCurlPassthroughOperators(
  operators: KulalaOperator[],
): KulalaOperator[] {
  const byFlag = new Map<string, KulalaOperator>();
  for (const op of operators) {
    const key = curlPassthroughFlagKey(op.name);
    if (key) byFlag.set(key, op);
  }
  return [...byFlag.values()];
}

export function curlArgvFromOperators(operators: KulalaOperator[]): string[] {
  const argv: string[] = [];
  for (const op of mergeCurlPassthroughOperators(operators)) {
    argv.push(...kulalaCurlOperatorToArgv(op));
  }
  return argv;
}

export function curlArgvHasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function looksLikeCurlFlag(token: string): boolean {
  return token.startsWith("-");
}

/**
 * Merge curl argv layers; later layers override earlier ones on the same flag token.
 * Pass-through only - no alias mapping or special flags.
 */
export function mergeCurlArgv(layers: string[][]): string[] {
  const byFlag = new Map<string, string[]>();

  const applyLayer = (layer: string[]) => {
    let i = 0;
    while (i < layer.length) {
      const arg = layer[i]!;
      if (!looksLikeCurlFlag(arg)) {
        i++;
        continue;
      }
      const segment = [arg];
      if (
        !arg.includes("=") &&
        i + 1 < layer.length &&
        !looksLikeCurlFlag(layer[i + 1]!)
      ) {
        segment.push(layer[i + 1]!);
        i += 2;
      } else {
        i += 1;
      }
      byFlag.set(arg, segment);
    }
  };

  for (const layer of layers) applyLayer(layer);
  return [...byFlag.values()].flat();
}
