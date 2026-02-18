import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaStdinActionRunLimit } from "../parser/types/stdinparsed";
import {
  writeRequestResponseToStderr,
  writeRequestResponseToStdout,
} from "../parser/lib/helpers";
import { getStableDocumentId, resolveVariables } from "../variables";
import {
  type PreviousResponse,
  resolveRequestVariable,
} from "../variables/request-vars";
import { findBlockAtCursor } from "./block";
import { doRequestFromBlock } from "./doRequest";
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaRunOptions,
} from "./types";

export type { KulalaRunOptions } from "./types";
export type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
} from "./types";

const run = async (
  doc: KulalaDocument,
  limit?: KulalaStdinActionRunLimit[],
  options?: KulalaRunOptions,
): Promise<void> => {
  const blocks: KulalaBlock[] = [];
  if (limit) {
    for (const l of limit) {
      if (l.filter === "cursorPosition") {
        const block = findBlockAtCursor(doc, {
          line: l.line,
          column: l.column,
        });
        if (!block) {
          writeRequestResponseToStderr({
            success: false,
            error: "No block found at the cursor position.",
          } as KulalaRequestErrorResponse);
          return;
        }
        blocks.push(block);
      }
      if (l.filter === "name") {
        const block = doc.blocks.find((b) => b.name === l.name);
        if (block) blocks.push(block);
      }
    }
  } else {
    blocks.push(...doc.blocks);
  }

  const env = options?.env ?? "default";
  const stableDocId = getStableDocumentId(doc.filepath, options?.content);
  const path = await import("path");
  const startDir = doc.filepath ? path.dirname(doc.filepath) : process.cwd();

  const results: (KulalaRequestSuccessResponse | KulalaRequestErrorResponse)[] =
    [];
  const previousResults = new Map<string, PreviousResponse>();
  for (const block of blocks) {
    const vars = await resolveVariables(env, stableDocId, block.name, startDir);

    // Apply variable overrides from run directive if present
    const runDirective = (block as any).__runDirective;
    if (runDirective?.variableOverrides) {
      for (const [key, value] of Object.entries(
        runDirective.variableOverrides,
      )) {
        vars[key] = value;
      }
    }

    const resolver = (key: string) =>
      resolveRequestVariable(key, previousResults);
    const result = await doRequestFromBlock(
      block,
      doc.filepath,
      vars,
      stableDocId,
      resolver,
    );
    results.push(result);
    if (result.success) {
      previousResults.set(block.name, {
        body: result.body,
        headers: result.headers,
      });
    }
  }
  writeRequestResponseToStdout(results);
};

export const KulalaRunner = () => {
  return {
    run,
  };
};
