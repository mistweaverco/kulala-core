export type KulalaStdinActionParse = {
  action: "parse";
  /* The path to the file where the contents come from, if any */
  filepath?: string;
  /* The full contents of the document to be processed */
  content: string;
};

export type KulalaStdinActionFormat = {
  action: "format";
  content: string;
  filepath?: string;
  formatBody?: boolean;
  bodyFormat?: {
    indent?: number;
    line_width?: number;
    expand_tabs?: boolean;
  };
  defaults?: {
    http_method?: string;
    http_version?: string | false;
  };
};

export type KulalaStdinActionSerialize = {
  action: "serialize";
  doc: import("./document").KulalaDocument;
  filepath?: string;
  includeExpandedBlocks?: boolean;
  preserveBodyText?: boolean;
};

export type KulalaStdinActionRunLimit =
  | {
      /* The cursor position is 1-based index
       * line: The line number where the cursor is located
       * column: The column number where the cursor is located
       * If not provided, means that the whole document should be considered
       */
      filter: "cursorPosition";
      line: number;
      column: number;
    }
  | {
      filter: "name";
      name: string;
    };

export type KulalaResponseFormatStdinOptions = {
  indent?: number;
  expand_tabs?: boolean;
  sort_keys?: boolean;
};

export type KulalaStdinActionRun = {
  action: "run";
  /* The full contents of the document to be processed */
  content: string;
  /* The path to the file where the contents come from, if any */
  filepath?: string;
  /** Environment name for variable lookup (withsecrets, http-client.env.json). Defaults to "default". */
  env?: string;
  limit?: KulalaStdinActionRunLimit[];
  /** Pretty-print response bodies (indentation, tabs vs spaces). */
  responseFormat?: KulalaResponseFormatStdinOptions;
  /** Optional jq filter for this run (block `# @kulala-jq` overrides). */
  jqFilter?: string;
  /** Stop running remaining requests after the first failure. */
  haltOnError?: boolean;
};

export type KulalaStdinActionApplyJqFilter = {
  action: "apply_jq_filter";
  /** Raw unfiltered response body text. */
  rawBody: string;
  /** jq filter expression. */
  filter: string;
  /** Source response Content-Type (affects formatting when output is JSON). */
  contentType?: string;
  responseFormat?: KulalaResponseFormatStdinOptions;
};

/** Convert an image body to a terminal-friendly format (e.g. JPEG → PNG). */
export type KulalaStdinActionConvertImage = {
  action: "convert_image";
  /** Base64-encoded image bytes. */
  content: string;
  mediaType?: string;
  /** Target format. Only `"png"` is supported today (Kitty graphics). */
  target: "png";
};

export type KulalaStdinActionContinue = {
  action: "continue";
  promptId: string;
  inputs: Array<{
    id: string;
    value: string;
  }>;
};

export type KulalaStdinActionCrypto = {
  action: "crypto";
  op:
    | "pkce_verifier"
    | "pkce_challenge"
    | "jwt_encode"
    | "base64_encode_standard";
  verifier?: string;
  method?: "S256" | "Plain";
  header?: { alg: string; typ?: string };
  payload?: Record<string, unknown>;
  key?: string;
  input?: string;
};

export type KulalaStdinActionHttpRequest = {
  action: "http_request";
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  insecure?: boolean;
  timeoutSec?: number;
  connectionTimeoutSec?: number;
  /** Working directory for kulala-core persistence (cookies, env files). */
  cwd?: string;
  /** Pretty-print response bodies (indentation, tabs vs spaces). */
  responseFormat?: KulalaResponseFormatStdinOptions;
};

export type KulalaStdinActionClearGlobals = {
  action: "clear_globals";
  /** When omitted or empty, clears all global-scope variables. */
  names?: string[];
};

/** Clear cached GraphQL introspection schema(s) by host. */
export type KulalaStdinActionClearGraphqlSchema = {
  action: "clear_graphql_schema";
  /** Host cache key (from URL). When omitted, clears all cached schemas. */
  host?: string;
};

/** Fetch and cache GraphQL introspection for the request at cursor. */
export type KulalaStdinActionGraphqlIntrospect = {
  action: "graphql_introspect";
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
};

/** Clear cached OpenAPI schema(s) by cache key. */
export type KulalaStdinActionClearOpenapiSchema = {
  action: "clear_openapi_schema";
  /** Cache key (host or file path). When omitted, clears all cached schemas. */
  cacheKey?: string;
};

/** Load OpenAPI spec and return explorer UI tree for block at cursor. */
export type KulalaStdinActionOpenapiLoad = {
  action: "openapi_load";
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
};

/** Run one OpenAPI operation with scripts inherited from parent block. */
export type KulalaStdinActionOpenapiRunOperation = {
  action: "openapi_run_operation";
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
  operationKey: string;
  parameterOverrides?: Record<string, string>;
  responseFormat?: KulalaResponseFormatStdinOptions;
};

/** Discover http-client.env.json / ws.yaml environments for UI pickers. */
export type KulalaStdinActionEnvironments = {
  action: "environments";
  /** Working directory to search upward from (http-client.env.json, ws.yaml). */
  cwd?: string;
  filepath?: string;
};

/** Resolved request preview at cursor (inspect). */
export type KulalaStdinActionInspectRequest = {
  action: "inspect_request";
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
};

/** Copy-as-curl for request at cursor. */
export type KulalaStdinActionToCurl = {
  action: "to_curl";
  content: string;
  filepath?: string;
  line: number;
  column: number;
  env?: string;
  userAgent?: string;
};

/** Paste-from-curl: parse clipboard curl into .http lines. */
export type KulalaStdinActionFromCurl = {
  action: "from_curl";
  curl: string;
};

/** Run curl with passthrough argv and return a formatted HTTP response. */
export type KulalaStdinActionCurl = {
  action: "curl";
  argv: string[];
  responseFormat?: KulalaResponseFormatStdinOptions;
};

export type KulalaLspPosition = {
  /** 1-based line number (vim-style). */
  line: number;
  /** 1-based column number (vim-style). */
  column: number;
};

export type KulalaStdinActionLspCompletion = {
  action: "lsp_completion";
  content: string;
  filepath?: string;
  env?: string;
  filetype?: string;
} & KulalaLspPosition;

export type KulalaStdinActionLspHover = {
  action: "lsp_hover";
  content: string;
  filepath?: string;
  env?: string;
  filetype?: string;
} & KulalaLspPosition;

export type KulalaStdinActionLspDocumentSymbols = {
  action: "lsp_symbols";
  content: string;
  filepath?: string;
};

export type KulalaStdinActionLspDiagnostics = {
  action: "lsp_diagnostics";
  content: string;
  filepath?: string;
};

export type KulalaStdinActionLspInlayHints = {
  action: "lsp_inlay_hints";
  content: string;
  filepath?: string;
  env?: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type KulalaStdinParsed =
  | KulalaStdinActionParse
  | KulalaStdinActionFormat
  | KulalaStdinActionSerialize
  | KulalaStdinActionRun
  | KulalaStdinActionApplyJqFilter
  | KulalaStdinActionConvertImage
  | KulalaStdinActionContinue
  | KulalaStdinActionCrypto
  | KulalaStdinActionHttpRequest
  | KulalaStdinActionClearGlobals
  | KulalaStdinActionClearGraphqlSchema
  | KulalaStdinActionGraphqlIntrospect
  | KulalaStdinActionClearOpenapiSchema
  | KulalaStdinActionOpenapiLoad
  | KulalaStdinActionOpenapiRunOperation
  | KulalaStdinActionEnvironments
  | KulalaStdinActionInspectRequest
  | KulalaStdinActionToCurl
  | KulalaStdinActionFromCurl
  | KulalaStdinActionCurl
  | KulalaStdinActionLspCompletion
  | KulalaStdinActionLspHover
  | KulalaStdinActionLspDocumentSymbols
  | KulalaStdinActionLspDiagnostics
  | KulalaStdinActionLspInlayHints;
