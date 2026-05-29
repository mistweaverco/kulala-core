import type { KulalaDocument, KulalaParser } from "./types";
import type { KulalaStdinParsed } from "./types/stdinparsed";
import { KulalaRunner } from "./../runner";
import {
  writeErrorToStderr,
  writeRequestResponseToStdout,
  writeToStdout,
} from "./lib/helpers";
import { getDocument } from "./parser";
import { loadEnvironmentCatalog } from "../variables/environments";
import { dirname } from "path";
import { continueOAuth2Flow } from "../auth/oauth2/continuation";
import { handleCryptoOp } from "../crypto";
import { httpRequest } from "../runner/http-client";
import {
  fromCurlCommand,
  inspectRequestAtCursor,
  toCurlAtCursor,
} from "../runner/request-cursor";
import {
  lspCompletion,
  lspDiagnostics,
  lspDocumentSymbols,
  lspHover,
} from "../lsp";
import {
  deleteVariable,
  getPrompt,
  deletePrompt,
  getVariables,
  setVariable,
} from "../persistence";
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
        writeToStdout(doc);
        break;
      case "run": {
        doc = await getDocument(stdIn.content, stdIn.filepath);
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
          const prompt = getPrompt(promptId);
          if (!prompt) {
            throw new Error(`Prompt not found or expired: ${promptId}`);
          }

          if (
            prompt.promptType === "oauth2_authorization_code" ||
            prompt.promptType === "oauth2_implicit_token"
          ) {
            // Continue OAuth2 flow (this will save the token)
            await continueOAuth2Flow(promptId, inputs);
          } else if (prompt.promptType === "custom") {
            const context = prompt.context as Record<string, unknown>;
            const stableDocId = String(context.stableDocId ?? "");
            const blockName = String(context.blockName ?? "");
            const varName = String(context.varName ?? "");
            const value = inputs.find((i) => i.id === varName)?.value;
            if (!stableDocId || !blockName || !varName) {
              throw new Error("Invalid custom prompt context");
            }
            if (value === undefined) {
              throw new Error(`Missing required input: ${varName}`);
            }
            // Store as request-scoped so it's only valid for the next run of this request.
            setVariable("request", varName, value, {
              document: stableDocId,
              blockName,
            });
            deletePrompt(promptId);
          } else {
            throw new Error(`Unsupported prompt type: ${prompt.promptType}`);
          }

          // Return success - the token is now saved and the original request can be retried
          const successResponse: KulalaResponseWrapper = {
            type: "responses",
            data: [
              {
                success: true,
                message:
                  "Prompt completed successfully. You can now retry the original request.",
                promptId,
              } as KulalaRequestSuccessResponse & {
                message: string;
                promptId: string;
              },
            ],
          };
          await writeRequestResponseToStdout(successResponse);
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
          await writeRequestResponseToStdout(errorResponse);
        }
        break;
      }
      case "crypto": {
        try {
          const value = await handleCryptoOp(
            stdIn.op,
            stdIn as Record<string, unknown>,
          );
          await writeRequestResponseToStdout({
            type: "crypto",
            success: true,
            value,
          });
        } catch (error) {
          await writeRequestResponseToStdout({
            type: "crypto",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "http_request": {
        try {
          const res = await httpRequest({
            url: stdIn.url,
            method: stdIn.method ?? "GET",
            headers: stdIn.headers ?? {},
            body: stdIn.body,
            insecure: stdIn.insecure,
            timeoutSec: stdIn.timeoutSec,
            connectionTimeoutSec: stdIn.connectionTimeoutSec,
          });
          const rawBody =
            typeof res.body === "string" ? res.body : res.body.toString("utf8");
          await writeRequestResponseToStdout({
            type: "http_request",
            success: true,
            status: res.statusCode,
            headers: res.headers,
            body: rawBody,
            url: res.url,
          });
        } catch (error) {
          await writeRequestResponseToStdout({
            type: "http_request",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }
      case "clear_globals": {
        const names = stdIn.names;
        if (!names || names.length === 0) {
          const vars = getVariables("global");
          for (const k of Object.keys(vars)) deleteVariable("global", k);
        } else {
          for (const name of names) deleteVariable("global", name);
        }
        await writeRequestResponseToStdout({
          type: "clear_globals",
          success: true,
        });
        break;
      }
      case "environments": {
        let startDir = stdIn.cwd ?? process.cwd();
        if (stdIn.filepath) {
          try {
            startDir = dirname(stdIn.filepath);
          } catch {
            // keep cwd
          }
        }
        const catalog = await loadEnvironmentCatalog(startDir);
        writeToStdout(catalog);
        break;
      }
      case "inspect_request": {
        const result = await inspectRequestAtCursor({
          content: stdIn.content,
          filepath: stdIn.filepath,
          line: stdIn.line,
          column: stdIn.column,
          env: stdIn.env,
        });
        writeToStdout(result);
        break;
      }
      case "to_curl": {
        const result = await toCurlAtCursor({
          content: stdIn.content,
          filepath: stdIn.filepath,
          line: stdIn.line,
          column: stdIn.column,
          env: stdIn.env,
          userAgent: stdIn.userAgent,
        });
        writeToStdout(result);
        break;
      }
      case "from_curl": {
        const result = fromCurlCommand(stdIn.curl);
        writeToStdout(result);
        break;
      }
      case "lsp_completion": {
        const result = await lspCompletion({
          content: stdIn.content,
          filepath: stdIn.filepath,
          env: stdIn.env ?? "default",
          line: stdIn.line,
          column: stdIn.column,
          filetype: stdIn.filetype ?? "http",
        });
        writeToStdout(result);
        break;
      }
      case "lsp_hover": {
        const result = await lspHover({
          content: stdIn.content,
          filepath: stdIn.filepath,
          env: stdIn.env ?? "default",
          line: stdIn.line,
          column: stdIn.column,
          filetype: stdIn.filetype ?? "http",
        });
        writeToStdout(result);
        break;
      }
      case "lsp_symbols": {
        const result = await lspDocumentSymbols({
          content: stdIn.content,
          filepath: stdIn.filepath,
        });
        writeToStdout(result);
        break;
      }
      case "lsp_diagnostics": {
        const result = await lspDiagnostics({
          content: stdIn.content,
          filepath: stdIn.filepath,
        });
        writeToStdout(result);
        break;
      }
      default:
        break;
    }
  },
};

export { kulalaParser as KulalaParser };
export { writeErrorToStderr };
