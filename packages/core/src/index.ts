export { KulalaParser, writeErrorToStderr } from "./lib/parser";
export { KulalaRunner } from "./lib/runner";
export { deserializeHttp, serializeHttp, formatHttp } from "./lib/parser";
export type {
  KulalaHttpSerdeSerializeOptions,
  KulalaHttpFormatOptions,
  KulalaHttpBodyFormatOptions,
  KulalaHttpFormatDefaults,
  KulalaHttpFormatResult,
} from "./lib/parser";

export {
  CURL_TOOL,
  getKulalaCoreCacheRoot,
  getKulalaCoreDataDir,
  getToolInstallRoot,
  resolveExternalBinary,
  resolvePlatformVendorSubdir,
} from "./lib/runner/external-tools";
export type {
  ArchiveDownloadSpec,
  ExternalToolDefinition,
  ExternalToolId,
  ResolveExternalBinaryOptions,
} from "./lib/runner/external-tools";

export type { KulalaDocument } from "./lib/parser/types";
export type { KulalaStdinParsed } from "./lib/parser/types/stdinparsed";

export {
  lspCompletion,
  lspDiagnostics,
  lspDocumentSymbols,
  lspHover,
} from "./lib/lsp";

export {
  clearGraphQLSchemaCache,
  introspectGraphQLAtCursor,
  graphQLLspCompletionItems,
  graphQLLspHover,
  type GraphQLLspCompletionResult,
  fetchGraphQLIntrospection,
  graphqlSchemaHostFromUrl,
  parseIntrospectionSchema,
  type ClearGraphQLSchemaCacheResult,
  type GraphQLIntrospectionResult,
  type GraphQLSchemaIndex,
} from "./lib/graphql";
export type {
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
} from "./lib/lsp";

export type { KulalaRunOptions } from "./lib/runner";
export {
  parseCurlCommand,
  formatCurlCommand,
  parseCurlToHttpSpec,
  curlToHttpFileLines,
} from "./lib/curl";
export type { CurlFormatInput, CurlParsedRequest } from "./lib/curl";
export type {
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaResponseWrapper,
  KulalaScriptConsoleLine,
  KulalaScriptConsoleOrigin,
} from "./lib/runner";

import { KulalaParser, formatHttp } from "./lib/parser";
import { KulalaRunner } from "./lib/runner";
import { getDocument } from "./lib/parser/parser";
import type { KulalaStdinActionRunLimit } from "./lib/parser/types/stdinparsed";
import type { KulalaResponseWrapper, KulalaRunOptions } from "./lib/runner";
import { runDocument } from "./lib/runner";
import type { KulalaDocument } from "./lib/parser/types";

const parse = async (input: {
  content: string;
  filepath?: string;
}): Promise<KulalaDocument> => {
  return await getDocument(input.content, input.filepath);
};

export const kulalaCore = {
  parser: KulalaParser,
  runner: KulalaRunner(),
  parse,
  validate: parse,
  format: formatHttp,
  run: async (input: {
    content: string;
    filepath?: string;
    env?: string;
    limit?: KulalaStdinActionRunLimit[];
  }): Promise<{ doc: KulalaDocument; response: KulalaResponseWrapper }> => {
    const doc = await getDocument(input.content, input.filepath);

    const options: KulalaRunOptions = {
      content: input.content,
      env: input.env ?? "default",
    };
    const response = await runDocument(doc, input.limit, options);
    return { doc, response };
  },
} as const;
