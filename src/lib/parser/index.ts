import type { KulalaDocument, KulalaParser } from "./types";
import type { KulalaStdinParsed } from "./types/stdinparsed";
import { KulalaRunner } from "./../runner";
import {
  writeErrorToStderr,
  writeToStderr,
  writeToStdout,
} from "./lib/helpers";
import { getDocument } from "./parser";
const kulalaRunner = KulalaRunner();

let stdIn: KulalaStdinParsed | null = null;

const kulalaParser: KulalaParser = {
  setInput: (input: KulalaStdinParsed) => {
    stdIn = input;
  },
  parse: async (): Promise<void> => {
    if (!stdIn) {
      throw new Error("No input provided. Call setInput() first or use stdin.");
    }

    let doc: KulalaDocument | null = null;
    switch (stdIn.action) {
      case "parse":
        doc = await getDocument(stdIn.content, stdIn.filepath);
        if (doc.hasErrors) {
          writeToStderr(doc);
          break;
        }
        writeToStdout(doc);
        break;
      case "run": {
        doc = await getDocument(stdIn.content, stdIn.filepath);
        if (doc.hasErrors) {
          writeToStderr(doc);
          break;
        }
        await kulalaRunner.run(doc, stdIn.limit, {
          content: stdIn.content,
          env: stdIn.env ?? "default",
        });
        break;
      }
      default:
        break;
    }
  },
};

export { kulalaParser as KulalaParser };
export { writeErrorToStderr };
