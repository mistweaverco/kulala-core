export { KulalaParser, writeErrorToStderr } from "./lib/parser";
export { KulalaRunner } from "./lib/runner";
export {
  deserializeHttp,
  serializeHttp,
  serializeHttpBlock,
  formatHttp,
} from "./lib/parser";
export type {
  KulalaHttpSerdeSerializeOptions,
  KulalaHttpFormatOptions,
  KulalaHttpBodyFormatOptions,
  KulalaHttpFormatDefaults,
  KulalaHttpFormatResult,
} from "./lib/parser";

export {
  CURL_TOOL,
  JQ_TOOL,
  getKulalaCoreCacheRoot,
  getKulalaCoreDataDir,
  getToolInstallRoot,
  resolveExternalBinary,
  resolvePlatformVendorSubdir,
} from "./lib/runner/external-tools";
export type {
  ArchiveDownloadSpec,
  BinaryDownloadSpec,
  ExternalToolDefinition,
  ExternalToolId,
  ResolveExternalBinaryOptions,
} from "./lib/runner/external-tools";

export { applyJqFilter, enrichResponseWithJq, runJq } from "./lib/jq";
export {
  convertImage,
  type ConvertImageInput,
  type ConvertImageResult,
  type ConvertImageTarget,
} from "./lib/image";

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
export {
  clearOpenAPISchemaCache,
  openAPILoadAtCursor,
  openAPIOperationToHttp,
  runOpenAPIOperation,
  openAPICacheKeyFromSource,
  parseOpenAPIRawText,
  buildOpenAPIIndex,
  buildOpenAPIUITree,
  openAPILspCompletionItems,
  openAPILspHover,
  prepareOpenAPIDocument,
  bundleOpenAPIRefs,
  type ClearOpenAPISchemaCacheResult,
  type OpenAPILspCompletionResult,
  type OpenAPIUiPayload,
  type OpenAPIUITreeNode,
  type OpenAPIIndex,
  type OpenAPIOperationToHttpResult,
} from "./lib/openapi";
export type {
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
} from "./lib/lsp";

export type { KulalaRunOptions } from "./lib/runner";
export type { KulalaResponseFormatOptions } from "./lib/runner/http-response-body";
export {
  buildRunnerResponseBody,
  formatJsonValue,
  formatXmlBody,
  responseBodyDisplayText,
  resolveResponseFormatOptions,
  DEFAULT_RESPONSE_FORMAT,
} from "./lib/runner/http-response-body";
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
    responseFormat?: KulalaRunOptions["responseFormat"];
    haltOnError?: boolean;
  }): Promise<{ doc: KulalaDocument; response: KulalaResponseWrapper }> => {
    const doc = await getDocument(input.content, input.filepath);

    const options: KulalaRunOptions = {
      content: input.content,
      env: input.env ?? "default",
      responseFormat: input.responseFormat,
      haltOnError: input.haltOnError,
    };
    const response = await runDocument(doc, input.limit, options);
    return { doc, response };
  },
} as const;
