/**
 * Host-keyed OpenAPI spec cache for explorer UI and operation runs.
 */
export const migration000005OpenapiSchemas = {
  version: 5,
  name: "openapi_schemas",
  statements: [
    `CREATE TABLE IF NOT EXISTS openapi_schemas (
    cache_key TEXT PRIMARY KEY,
    spec_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    `CREATE INDEX IF NOT EXISTS idx_openapi_schemas_updated ON openapi_schemas(updated_at)`,
  ],
} as const;
