export type OpenAPIUITreeNodeKind =
  | "section"
  | "operation"
  | "parameter"
  | "response"
  | "schema"
  | "text"
  | "tryItOut";

export type OpenAPIUITreeNode = {
  id: string;
  kind: OpenAPIUITreeNodeKind;
  title: string;
  badge?: string;
  description?: string;
  children?: OpenAPIUITreeNode[];
  /** Stable key for `openapi_run_operation` (e.g. `GET /pets/{id}`). */
  operationKey?: string;
  /** Parameter name when kind is `parameter` or `tryItOut`. */
  paramName?: string;
  /** Parameter location: path, query, header, cookie. */
  paramIn?: string;
  /** Default / current value for try-it-out fields. */
  defaultValue?: string;
  /** When true, the panel allows editing this node's value. */
  editable?: boolean;
  /** Selectable values (Try it out dropdown). */
  options?: string[];
  /** Hint for UI editors: free text, single pick, or multi pick (array enums). */
  inputType?: "text" | "select" | "multiSelect";
};

export type OpenAPIUiPayload = {
  cacheKey: string;
  fromCache: boolean;
  tree: OpenAPIUITreeNode[];
  title?: string;
  version?: string;
};

export type OpenAPIParameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
};

export type OpenAPIOperation = {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: OpenAPIParameter[];
  requestBody?: {
    description?: string;
    required?: boolean;
    content?: Record<string, unknown>;
  };
  responses?: Record<string, unknown>;
};

export type OpenAPIIndex = {
  openapi: string;
  title?: string;
  version?: string;
  servers: string[];
  operations: Map<string, OpenAPIOperation>;
  schemas: Map<string, Record<string, unknown>>;
  /** Resolved spec source URL or absolute file path. */
  specSource?: string;
};

export type OpenAPIDocument = Record<string, unknown>;
