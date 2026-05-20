export type KulalaStdinActionParse = {
  action: "parse";
  /* The path to the file where the contents come from, if any */
  filepath?: string;
  /* The full contents of the document to be processed */
  content: string;
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

export type KulalaStdinActionRun = {
  action: "run";
  /* The full contents of the document to be processed */
  content: string;
  /* The path to the file where the contents come from, if any */
  filepath?: string;
  /** Environment name for variable lookup (kuba, http-client.env.json). Defaults to "default". */
  env?: string;
  limit?: KulalaStdinActionRunLimit[];
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
};

export type KulalaStdinActionClearGlobals = {
  action: "clear_globals";
  /** When omitted or empty, clears all global-scope variables. */
  names?: string[];
};

/** Discover http-client.env.json / kuba.yaml environments for UI pickers. */
export type KulalaStdinActionEnvironments = {
  action: "environments";
  /** Working directory to search upward from (http-client.env.json, kuba.yaml). */
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

export type KulalaStdinParsed =
  | KulalaStdinActionParse
  | KulalaStdinActionRun
  | KulalaStdinActionContinue
  | KulalaStdinActionCrypto
  | KulalaStdinActionHttpRequest
  | KulalaStdinActionClearGlobals
  | KulalaStdinActionEnvironments
  | KulalaStdinActionInspectRequest
  | KulalaStdinActionToCurl
  | KulalaStdinActionFromCurl;
