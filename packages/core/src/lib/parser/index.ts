import type { KulalaDocument, KulalaParser } from "./types";
import type { KulalaStdinParsed } from "./types/stdinparsed";
import { KulalaRunner } from "./../runner";
import {
  writeErrorToStderr,
  writeRequestResponseToStdout,
  writeToStderr,
  writeToStdout,
} from "./lib/helpers";
import { getDocument } from "./parser";
import { continueOAuth2Flow } from "../auth/oauth2/continuation";
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaResponseWrapper,
} from "../runner/types";
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
      case "continue": {
        // Handle continuation of a prompt
        const { promptId, inputs } = stdIn;

        try {
          // Continue OAuth2 flow (this will save the token)
          await continueOAuth2Flow(promptId, inputs);

          // Return success - the token is now saved and the original request can be retried
          const successResponse: KulalaResponseWrapper = {
            type: "responses",
            data: [
              {
                success: true,
                message:
                  "OAuth2 flow completed successfully. You can now retry the original request.",
                promptId,
              } as KulalaRequestSuccessResponse & {
                message: string;
                promptId: string;
              },
            ],
          };
          writeRequestResponseToStdout(successResponse);
        } catch (error) {
          const errorResponse: KulalaResponseWrapper = {
            type: "error",
            data: [
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                promptId,
              } as KulalaRequestErrorResponse & { promptId: string },
            ],
          };
          writeRequestResponseToStdout(errorResponse);
        }
        break;
      }
      default:
        break;
    }
  },
};

export { kulalaParser as KulalaParser };
export { writeErrorToStderr };
