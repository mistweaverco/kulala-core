import type { KulalaRequest } from "./request.ts";
import type { KulalaOperator } from "./operator";
import type { KulalaComment } from "./comment";
import type { KulalaScripts } from "./script";
import type { KulalaError } from "./error.ts";

// Preamble: everything before the request line (operators and comments in order).
export type KulalaPreambleEntry = KulalaOperator | KulalaComment;

export type KulalaBlock = {
  name: string;
  errors: KulalaError[];
  // Ordered list of operators and comments before the request line.
  preamble: KulalaPreambleEntry[];
  comments: KulalaComment[];
  operators: KulalaOperator[];
  request: KulalaRequest;
  scripts: KulalaScripts;
  position: {
    start: number;
    end: number;
  };
};

export type KulalaBlockLineNumber = number;

export type KulalaBlockLineTypeName =
  | "afterBody"
  | "afterHeaders"
  | "body"
  | "comment"
  | "headers"
  | "name"
  | "operator"
  | "postRequestScript"
  | "preRequestScript"
  | "request"
  | "requestContinuation"
  | "unknown";

export type KulalaBlockLineType = {
  name: KulalaBlockLineTypeName;
  lineNumber: KulalaBlockLineNumber;
};

export type KulalaSeenBlockLineTypes = Set<KulalaBlockLineTypeName>;
