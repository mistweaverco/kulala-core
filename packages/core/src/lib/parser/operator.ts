import type { KulalaError } from "./types/error";
import type { KulalaOperator } from "./types/operator";
import { kulalaOperatorNames } from "./types/operator";

const operatorNameRequiresArgs = new Set([
  "name",
  "accept",
  "timeout",
  "connection-timeout",
  "kulala-prompt",
  "kulala-curl-timeout",
  "kulala-curl-connect-timeout",
  "kulala-file-contents-to-variable",
  "kulala-expect-status-code",
  "grpc-import-path",
  "grpc-proto",
  "grpc-protoset",
]);

export const getOperator = (
  line: string,
  lineIdx: number,
): KulalaOperator | KulalaError => {
  const match = line.match(/^(?:#|\/\/)\s*@([A-z0-9_-]+)(?:\s+(.*))?$/);
  if (!match) {
    return {
      errorMessage: `Invalid operator syntax at line ${lineIdx + 1}`,
      lineNumber: lineIdx,
      context: line,
    };
  }
  if (match.length < 2) {
    return {
      errorMessage: `Invalid operator syntax at line ${lineIdx + 1}`,
      lineNumber: lineIdx,
      context: match,
    };
  }
  if (operatorNameRequiresArgs.has(match[1]) && !match[2]) {
    return {
      errorMessage: `Operator "${match[1]}" requires an argument at line ${
        lineIdx + 1
      }`,
      lineNumber: lineIdx,
      context: line,
    };
  }
  if (!kulalaOperatorNames.has(match[1] as KulalaOperator["name"])) {
    return {
      errorMessage: `Unknown operator "${match[1]}" at line ${lineIdx + 1}`,
      lineNumber: lineIdx,
      context: line,
    };
  }
  return {
    name: match[1] as KulalaOperator["name"],
    args: match[2] || undefined,
    lineNumber: lineIdx,
  };
};

const isOperatorError = (obj: unknown): obj is KulalaError =>
  typeof obj === "object" && obj !== null && "errorMessage" in obj;

/** Operators (`# @…` / `// @…`) before the first `###` block marker. */
export function extractFileHeaderOperators(content: string): KulalaOperator[] {
  const out: KulalaOperator[] = [];
  let lineIdx = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.startsWith("###")) break;
    if (line.startsWith("# @") || line.startsWith("// @")) {
      const op = getOperator(line, lineIdx);
      if (!isOperatorError(op)) out.push(op);
    }
    lineIdx++;
  }
  return out;
}

export function hasVscodeRestclientCompatOperator(
  operators: KulalaOperator[],
): boolean {
  return operators.some((o) => o.name === "vscode-restclient-compat");
}
