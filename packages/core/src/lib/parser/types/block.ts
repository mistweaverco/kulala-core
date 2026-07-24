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
  /** 1-based file line where parsed request content begins (implicit blocks include file-header lines in `position`). */
  contentStartLine?: number;
  /** @name=value lines in this block before the request (JetBrains in-file variables). */
  preambleVariables?: Record<string, string>;
  /** Empty line between preamble and request line in the source file. */
  blankLineBeforeRequest?: boolean;
  /**
   * `#` / `//` comment lines after the request body (e.g. a commented-out next request).
   * Kept separate so body formatting does not drop them.
   */
  trailingComments?: KulalaComment[];
  /** False when the block has no request line (comments / operators only). */
  hasRequest?: boolean;
  /** @ variables from the start of the .http file this block was parsed from (imports / run file). */
  sourceFileHeaderVariables?: Record<string, string>;
  /** `# @kulala-vscode-restclient-compat` from the source .http file (imports / run file). */
  sourceVscodeRestclientCompat?: boolean;
  /** File-header operators from the source .http file (imports / run file). */
  sourceFileHeaderOperators?: KulalaOperator[];
  /** Block only contains `run ./file.http`; expanded targets are separate blocks. */
  runExpander?: boolean;
  /** This block was expanded from a parent block's `run ./file.http`. */
  runParentBlock?: string;
};

export type KulalaBlockLineNumber = number;

export type KulalaBlockLineTypeName =
  | "afterBody"
  | "afterHeaders"
  | "body"
  | "comment"
  | "docVariable"
  | "headers"
  | "name"
  | "operator"
  | "postRequestScript"
  | "preRequestScript"
  | "request"
  | "requestContinuation"
  | "responseRedirect"
  | "unknown";

export type KulalaBlockLineType = {
  name: KulalaBlockLineTypeName;
  lineNumber: KulalaBlockLineNumber;
};

export type KulalaSeenBlockLineTypes = Set<KulalaBlockLineTypeName>;
