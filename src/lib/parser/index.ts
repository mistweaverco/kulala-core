import type { KulalaDocument, KulalaParser } from "./types";
import { KulalaRunner } from "./../runner";
import {
  getAllContentsFromStdinAtOnce,
  writeErrorToStderr,
  writeToStderr,
  writeToStdout,
} from "./lib/helpers";
import { getDocument } from "./parser";
const kulalaParser = {} as KulalaParser;
const kulalaRunner = KulalaRunner();

const stdIn = await getAllContentsFromStdinAtOnce();

kulalaParser.parse = async (): Promise<void> => {
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
};

export { kulalaParser as KulalaParser };
export { writeErrorToStderr };
