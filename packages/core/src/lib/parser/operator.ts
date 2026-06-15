import { isKulalaCurlPassthroughOperator } from "../curl/passthrough";
import { isRequestLine } from "./request";
import { isPreRequestScriptLine } from "./script";
import type { KulalaError } from "./types/error";
import type { KulalaOperator } from "./types/operator";
import { kulalaOperatorNames } from "./types/operator";

const operatorNameRequiresArgs = new Set([
  "name",
  "accept",
  "timeout",
  "connection-timeout",
  "kulala-prompt",
  "kulala-file-contents-to-variable",
  "kulala-expect-status-code",
  "kulala-jq",
  "jq",
  "grpc-import-path",
  "grpc-proto",
  "grpc-protoset",
]);

export const getOperator = (
  line: string,
  lineIdx: number,
): KulalaOperator | KulalaError => {
  const match = line.match(/^(?:#|\/\/)\s*@([A-Za-z0-9_-]+)(?:\s+(.*))?$/);
  const commentStyle = line.trimStart().startsWith("//") ? "//" : "#";
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
  const operatorName = match[1]!;
  const isKnown =
    kulalaOperatorNames.has(operatorName as KulalaOperator["name"]) ||
    isKulalaCurlPassthroughOperator(operatorName);
  if (operatorNameRequiresArgs.has(operatorName) && !match[2]) {
    return {
      errorMessage: `Operator "${operatorName}" requires an argument at line ${lineIdx + 1}`,
      lineNumber: lineIdx,
      context: line,
    };
  }
  if (!isKnown) {
    return {
      errorMessage: `Unknown operator "${operatorName}" at line ${lineIdx + 1}`,
      lineNumber: lineIdx,
      context: line,
    };
  }
  return {
    name: operatorName as KulalaOperator["name"],
    args: match[2] || undefined,
    lineNumber: lineIdx,
    commentStyle,
  };
};

const isOperatorError = (obj: unknown): obj is KulalaError =>
  typeof obj === "object" && obj !== null && "errorMessage" in obj;

/** Operators (`# @…` / `// @…`) before the first request or `###` block marker. */
export function extractFileHeaderOperators(content: string): KulalaOperator[] {
  const out: KulalaOperator[] = [];
  let lineIdx = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (
      t.startsWith("###") ||
      isRequestLine(line) ||
      isPreRequestScriptLine(line)
    )
      break;
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
  return operators.some((o) => o.name === "kulala-vscode-restclient-compat");
}
