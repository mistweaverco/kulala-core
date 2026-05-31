/**
 * Host-keyed GraphQL introspection schema cache for LSP completions.
 */
export const migration000002GraphqlSchemas = {
  version: 2,
  name: "graphql_schemas",
  statements: [
    `CREATE TABLE IF NOT EXISTS graphql_schemas (
    host TEXT PRIMARY KEY,
    schema_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    `CREATE INDEX IF NOT EXISTS idx_graphql_schemas_updated ON graphql_schemas(updated_at)`,
  ],
} as const;
