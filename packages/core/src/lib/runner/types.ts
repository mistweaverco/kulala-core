/** Captured `console.log` / `console.error` / etc. from pre- and post-request scripts (stdout stays JSON-only). */
export type KulalaScriptConsoleLine = {
  level: "log" | "error" | "warn" | "info" | "debug";
  message: string;
};

/** Request as sent (after scripts and variable substitution). */
export type KulalaRequestSent = {
  method: string;
  /** URL used for the initial request (before redirects). */
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

/** Returned for WS/WSS — nvim starts a native WebSocket session via kulala-core. */
export type KulalaWebSocketPlanResponse = {
  success: true;
  protocol: "websocket";
  url: string;
  initialMessage?: string;
  request?: KulalaRequestSent;
};

export type KulalaRequestSuccessResponse = {
  success: true;
  /** `###` block name for this request (for multi-run / `run ./file.http` consumers). */
  blockName?: string;
  status: number;
  headers: Record<string, string>;
  /** Final resolved URL (after redirects). */
  url: string;
  /** Resolved request as sent (matches scripts, env, and magic variables). */
  request?: KulalaRequestSent;
  /** Present only when at least one redirect occurred (ordered hops, including the final response). */
  redirectChain?: Array<{
    status: number;
    headers: Record<string, string>;
    url: string;
    body:
      | { type: "text"; content: string }
      | { type: "json"; content: Record<string, unknown> };
    timings: {
      dns: number;
      tcp: number;
      tls: number;
      request: number;
      redirect: number;
      firstByte: number;
      startTransfer: number;
      total: number;
    };
    /** curl `-v` stderr for this hop. */
    verboseTrace?: string;
  }>;
  /** curl `-v` stderr for the final hop. */
  verboseTrace?: string;
  timings: {
    dns: number;
    tcp: number;
    tls: number;
    request: number;
    redirect: number;
    /** Time from request sent to first byte (server TTFB). */
    firstByte: number;
    /** Time from start to first byte; matches curl time_starttransfer. */
    startTransfer: number;
    total: number;
  };
  body:
    | { type: "text"; content: string }
    | { type: "json"; content: Record<string, unknown> };
  /** Present when scripts emitted console output (including client.test / client.log). */
  scriptConsole?: KulalaScriptConsoleLine[];
};

export type KulalaRequestErrorResponse = {
  success: false;
  blockName?: string;
  error: string;
};

export type KulalaPromptResponse = {
  success: false;
  prompt: true;
  promptId: string;
  promptType: string;
  message: string;
  inputs: Array<{
    id: string;
    label: string;
    type: "text" | "password" | "url";
    required?: boolean;
  }>;
};

export type KulalaResponseWrapper =
  | {
      type: "responses";
      data: Array<
        | KulalaRequestSuccessResponse
        | KulalaRequestErrorResponse
        | KulalaPromptResponse
        | KulalaWebSocketPlanResponse
      >;
    }
  | {
      type: "error";
      data: Array<KulalaRequestErrorResponse>;
    };

export type RequestHeaderType =
  | "json"
  | "form-data"
  | "form-urlencoded"
  | "invalid";

export type VariableResolver = (name: string) => string | undefined;

export type KulalaRunOptions = {
  /** Raw document content (for stable ID when filepath is absent). */
  content?: string;
  /** Environment name for variable resolution (kuba, etc.). Defaults to "default". */
  env?: string;
};

/** Response-like value passed to scripts (fetch Response or compatible). */
export type RunnerResponseLike = {
  body: unknown;
  statusCode: number;
  headers: Record<string, string>;
  timings: { phases: Record<string, number> };
};
