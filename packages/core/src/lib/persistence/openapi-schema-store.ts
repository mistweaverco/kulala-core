import { getDb } from "./db";

export type OpenAPISchemaRecord = {
  cacheKey: string;
  spec: Record<string, unknown>;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function loadOpenAPISchema(
  cacheKey: string,
): OpenAPISchemaRecord | undefined {
  const db = getDb();
  const row = db
    .query<
      { spec_json: string; updated_at: string },
      [string]
    >("SELECT spec_json, updated_at FROM openapi_schemas WHERE cache_key = ?")
    .get(cacheKey);
  if (!row) return undefined;
  try {
    const spec = JSON.parse(row.spec_json) as Record<string, unknown>;
    return { cacheKey, spec, updatedAt: row.updated_at };
  } catch {
    return undefined;
  }
}

export function saveOpenAPISchema(
  cacheKey: string,
  spec: Record<string, unknown>,
): void {
  const db = getDb();
  const now = nowIso();
  const specJson = JSON.stringify(spec);
  db.run(
    `INSERT INTO openapi_schemas (cache_key, spec_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       spec_json = excluded.spec_json,
       updated_at = excluded.updated_at`,
    [cacheKey, specJson, now],
  );
}

export function deleteOpenAPISchema(cacheKey: string): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM openapi_schemas WHERE cache_key = ?", [
    cacheKey,
  ]);
  return (result as { changes: number }).changes > 0;
}

export function clearOpenAPISchemas(): number {
  const db = getDb();
  const countRow = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM openapi_schemas")
    .get();
  const n = countRow?.n ?? 0;
  if (n > 0) db.run("DELETE FROM openapi_schemas");
  return n;
}

export function listOpenAPISchemaKeys(): string[] {
  const db = getDb();
  const rows = db
    .query<
      { cache_key: string },
      []
    >("SELECT cache_key FROM openapi_schemas ORDER BY cache_key")
    .all();
  return rows.map((r) => r.cache_key);
}
