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
