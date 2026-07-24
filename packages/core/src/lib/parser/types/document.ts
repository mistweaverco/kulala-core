import type { KulalaVariable } from "./variable";
import type { KulalaBlock } from "./block";
import type { KulalaDirective } from "./directive";
import type { KulalaOperator } from "./operator";
import type { KulalaComment } from "./comment";
import type { KulalaError } from "./error";
export type KulalaDocument = {
  filepath?: string;
  variables?: Record<string, KulalaVariable>;
  /** @name=value definitions before the first ### block (JetBrains in-file variables). */
  fileHeaderVariables?: Record<string, string>;
  /** `# @kulala-vscode-restclient-compat` before the first ### - enables {{REQUEST.response…}} vars. */
  vscodeRestclientCompat?: boolean;
  /** `# @…` / `// @…` operators before the first ### (e.g. `# @kulala-curl--insecure`). */
  fileHeaderOperators?: KulalaOperator[];
  /**
   * Plain `#` / `//` comments before the first ### / request
   * (including fully commented-out requests at the top of the file).
   */
  fileHeaderComments?: KulalaComment[];
  directives: KulalaDirective[];
  blocks: KulalaBlock[];
  hasErrors?: boolean;
  /** All parse/import/run resolution errors with absolute (1-based) line numbers. */
  errors?: KulalaError[];
  /** Number of directive lines removed from the top of the file. Used to adjust cursor positions. */
  directiveLinesRemoved?: number;
  /** Number of native blocks (blocks from the current file, excluding imported/run blocks). */
  nativeBlockCount?: number;
};
