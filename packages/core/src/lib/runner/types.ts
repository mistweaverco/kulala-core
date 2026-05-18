/** Captured `console.log` / `console.error` / etc. from pre- and post-request scripts (stdout stays JSON-only). */
export type KulalaScriptConsoleLine = {
  level: "log" | "error" | "warn" | "info" | "debug";
  message: string;
};

/** Returned for WS/WSS — nvim starts a native WebSocket session via kulala-core. */
export type KulalaWebSocketPlanResponse = {
  success: true;
  protocol: "websocket";
  url: string;
  initialMessage?: string;
};

export type KulalaRequestSuccessResponse = {
  success: true;
  status: number;
  headers: Record<string, string>;
  /** Final resolved URL (after redirects). */
  url: string;
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
  }>;
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
