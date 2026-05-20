import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaStdinActionRunLimit } from "../parser/types/stdinparsed";
import type { KulalaRunDirective } from "../parser/types/directive";
import {
  writeRequestResponseToStderr,
  writeRequestResponseToStdout,
} from "../parser/lib/helpers";
import { getStableDocumentId, resolveVariables } from "../variables";
import {
  type PreviousResponse,
  resolveRequestVariable,
} from "../variables/request-vars";
import {
  filterExecutableBlocks,
  findBlocksAtCursor,
  resolveBlocksToRun,
} from "./block";
import { doRequestFromBlock } from "./doRequest";
import { collectSharedGrpcFlags, grpcFlagsFromOperators } from "../grpc";
import type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaPromptResponse,
  KulalaWebSocketPlanResponse,
  KulalaRunOptions,
  KulalaResponseWrapper,
} from "./types";
import type { ScriptFlowContext } from "./scripts";

/** JetBrains `# @name REQUEST_ID` — key for {{REQUEST_ID.response...}} (falls back to `###` block name). */
export function getBlockResultKey(block: KulalaBlock): string {
  const nameOp = block.operators.find((o) => o.name === "name");
  const alias = nameOp?.args != null ? String(nameOp.args).trim() : "";
  return alias !== "" ? alias : block.name;
}

export type { KulalaRunOptions } from "./types";
export type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaResponseWrapper,
  KulalaScriptConsoleLine,
  KulalaScriptConsoleOrigin,
} from "./types";

export async function runDocument(
  doc: KulalaDocument,
  limit?: KulalaStdinActionRunLimit[],
  options?: KulalaRunOptions,
): Promise<KulalaResponseWrapper> {
  const blocks: KulalaBlock[] = [];
  if (limit) {
    for (const l of limit) {
      if (l.filter === "cursorPosition") {
        const matched = findBlocksAtCursor(doc, {
          line: l.line,
          column: l.column,
        });
        if (matched.length === 0) {
          const errorResponse: KulalaResponseWrapper = {
            type: "error",
            data: [
              {
                success: false,
                error: "No block found at the cursor position.",
              } as KulalaRequestErrorResponse,
            ],
          };
          return errorResponse;
        }
        for (const block of matched) {
          if (!blocks.find((b) => b.name === block.name)) {
            blocks.push(block);
          }
        }
      }
      if (l.filter === "name") {
        const block = doc.blocks.find((b) => b.name === l.name);
        if (block) {
          for (const expanded of resolveBlocksToRun(doc, block)) {
            if (!blocks.find((b) => b.name === expanded.name)) {
              blocks.push(expanded);
            }
          }
        }
      }
    }
  } else {
    blocks.push(...filterExecutableBlocks(doc.blocks));
  }

  const env = options?.env ?? "default";
  const stableDocId = getStableDocumentId(doc.filepath, options?.content);
  const path = await import("path");
  const startDir = doc.filepath ? path.dirname(doc.filepath) : process.cwd();

  const results: (
    | KulalaRequestSuccessResponse
    | KulalaRequestErrorResponse
    | KulalaPromptResponse
    | KulalaWebSocketPlanResponse
  )[] = [];
  const previousResults = new Map<string, PreviousResponse>();
  const flow: ScriptFlowContext = {
    globalHeaders: {},
    sharedGrpcFlags: collectSharedGrpcFlags(doc.blocks, startDir),
    sharedBlocks: doc.blocks.filter(
      (b) => b.name === "Shared" || b.name === "Shared each",
    ),
  };
  for (const block of blocks) {
    const vars = await resolveVariables(
      env,
      stableDocId,
      block.name,
      startDir,
      {
        fileHeader:
          block.sourceFileHeaderVariables ??
          doc.fileHeaderVariables ??
          undefined,
        blockPreamble: block.preambleVariables,
      },
    );

    // Apply variable overrides from run directive if present
    const runDirective = (block as { __runDirective?: KulalaRunDirective })
      .__runDirective;
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
      env,
      flow,
    );
    const resultItems = Array.isArray(result) ? result : [result];
    for (const item of resultItems) {
      results.push({ ...item, blockName: block.name });

      // If we got a prompt response, stop processing and return it
      if (!item.success && "prompt" in item && item.prompt) {
        const responseWrapper: KulalaResponseWrapper = {
          type: "responses",
          data: results,
        };
        return responseWrapper;
      }

      if (item.success && "status" in item && "body" in item) {
        previousResults.set(getBlockResultKey(block), {
          body: item.body,
          headers: item.headers,
        });
      }
    }
  }
  const responseWrapper: KulalaResponseWrapper = {
    type: "responses",
    data: results,
  };
  return responseWrapper;
}

export const KulalaRunner = () => {
  return {
    run: async (
      doc: KulalaDocument,
      limit?: KulalaStdinActionRunLimit[],
      options?: KulalaRunOptions,
    ): Promise<void> => {
      const res = await runDocument(doc, limit, options);
      if (res.type === "error") {
        writeRequestResponseToStderr(res);
        return;
      }
      writeRequestResponseToStdout(res);
    },
  };
};
