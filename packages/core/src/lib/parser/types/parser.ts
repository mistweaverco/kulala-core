import type { KulalaStdinParsed } from "./stdinparsed";

export type KulalaParser = {
  setInput: (input: KulalaStdinParsed) => void;
  parse: () => Promise<void>;
};
