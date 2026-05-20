/**
 * Minimal shell-like argument splitting (quotes, escapes). Good enough for curl one-liners.
 */
export function splitShellArgs(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  let cur = "";
  let quote: "'" | '"' | null = null;

  const push = (): void => {
    if (cur.length > 0 || out.length === 0) out.push(cur);
    cur = "";
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      i += 1;
      while (i < input.length && /\s/.test(input[i]!)) i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < input.length) {
      cur += input[i + 1];
      i += 2;
      continue;
    }
    cur += ch;
    i += 1;
  }
  push();
  return out;
}
