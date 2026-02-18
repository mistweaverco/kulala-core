import type { KulalaVariable } from "./variable";
import type { KulalaBlock } from "./block";
import type { KulalaDirective } from "./directive";
export type KulalaDocument = {
  filepath?: string;
  variables?: Record<string, KulalaVariable>;
  directives: KulalaDirective[];
  blocks: KulalaBlock[];
  hasErrors?: boolean;
};
