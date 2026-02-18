export type KulalaRequestSuccessResponse = {
  success: true;
  status: number;
  headers: Record<string, string>;
  timings: {
    namelookup: number;
    connect: number;
    appconnect: number;
    pretransfer: number;
    redirect: number;
    starttransfer: number;
  };
  body:
    | { type: "text"; content: string }
    | { type: "json"; content: Record<string, unknown> };
};

export type KulalaRequestErrorResponse = {
  success: false;
  error: string;
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
