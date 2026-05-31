import { getDb } from "./db";

export type GraphQLSchemaRecord = {
  host: string;
  schema: Record<string, unknown>;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function loadGraphQLSchema(
  host: string,
): GraphQLSchemaRecord | undefined {
  const db = getDb();
  const row = db
    .query<
      { schema_json: string; updated_at: string },
      [string]
    >("SELECT schema_json, updated_at FROM graphql_schemas WHERE host = ?")
    .get(host);
  if (!row) return undefined;
  try {
    const schema = JSON.parse(row.schema_json) as Record<string, unknown>;
    return { host, schema, updatedAt: row.updated_at };
  } catch {
    return undefined;
  }
}

export function saveGraphQLSchema(
  host: string,
  schema: Record<string, unknown>,
): void {
  const db = getDb();
  const now = nowIso();
  const schemaJson = JSON.stringify(schema);
  db.run(
    `INSERT INTO graphql_schemas (host, schema_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(host) DO UPDATE SET
       schema_json = excluded.schema_json,
       updated_at = excluded.updated_at`,
    [host, schemaJson, now],
  );
}

/** Remove cached schema for one host. Returns whether a row was deleted. */
export function deleteGraphQLSchema(host: string): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM graphql_schemas WHERE host = ?", [host]);
  return (result as { changes: number }).changes > 0;
}

/** Clear all cached GraphQL schemas. Returns number of rows removed. */
export function clearGraphQLSchemas(): number {
  const db = getDb();
  const countRow = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM graphql_schemas")
    .get();
  const n = countRow?.n ?? 0;
  if (n > 0) db.run("DELETE FROM graphql_schemas");
  return n;
}

export function listGraphQLSchemaHosts(): string[] {
  const db = getDb();
  const rows = db
    .query<
      { host: string },
      []
    >("SELECT host FROM graphql_schemas ORDER BY host")
    .all();
  return rows.map((r) => r.host);
}
