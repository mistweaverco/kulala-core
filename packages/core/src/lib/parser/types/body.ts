export type KulalaRequestBodyType =
  | "json"
  | "form"
  | "file"
  | "raw"
  | "graphql"
  | "bodyFromFile";

export type KulalaRequestGraphQLBody = {
  query: string;
  variables?: Record<string, unknown>;
};

export type KulalaRequestFormBody = {
  [key: string]: string;
};

export type KulalaRequestFileBody = {
  /** The path to the file to be uploaded */
  filePath: string;
  /** The filename to be used in the request, if different from the actual file name */
  filename?: string;
};

/** Body read from a file (JetBrains-style `< path` syntax). Stored under __bodyFromFile to avoid conflicting with JSON payloads. */
export type KulalaRequestBodyFromFileContent = {
  __bodyFromFile: string;
  /** GRAPHQL only: variables JSON in the .http file after the `< path` line. */
  __graphqlVariablesSuffix?: string;
};

export type KulalaRequestRawBody = {
  contentType?: string;
};

export type KulalaRequestBody =
  | { type: "json"; content: string; sourceText?: string }
  | { type: "form"; content: KulalaRequestFormBody; sourceText?: string }
  | { type: "file"; content: KulalaRequestFileBody; sourceText?: string }
  | { type: "raw"; content: string; sourceText?: string }
  | { type: "graphql"; content: KulalaRequestGraphQLBody; sourceText?: string }
  | {
      type: "bodyFromFile";
      content: KulalaRequestBodyFromFileContent;
      sourceText?: string;
    };
