import type { KulalaVariable } from "./variable";
import type { KulalaBlock } from "./block";
import type { KulalaDirective } from "./directive";
export type KulalaDocument = {
  filepath?: string;
  variables?: Record<string, KulalaVariable>;
  /** @name=value definitions before the first ### block (JetBrains in-file variables). */
  fileHeaderVariables?: Record<string, string>;
  /** `# @vscode-restclient-compat` before the first ### — enables {{REQUEST.response…}} vars. */
  vscodeRestclientCompat?: boolean;
  directives: KulalaDirective[];
  blocks: KulalaBlock[];
  hasErrors?: boolean;
  /** Number of directive lines removed from the top of the file. Used to adjust cursor positions. */
  directiveLinesRemoved?: number;
  /** Number of native blocks (blocks from the current file, excluding imported/run blocks). */
  nativeBlockCount?: number;
};
