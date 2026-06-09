import type { Database } from "bun:sqlite";

/** Dedupe cookie_jar rows and normalize NULL default ports to 0. */
export function dedupeCookieJarDefaultPorts(db: Database): void {
  const table = db
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cookie_jar'")
    .get();
  if (!table) return;

  db.run(`DELETE FROM cookie_jar
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY domain, COALESCE(port, 0), path, name
            ORDER BY updated_at DESC, id DESC
          ) AS rn
        FROM cookie_jar
      ) WHERE rn = 1
    )`);

  db.run("UPDATE cookie_jar SET port = 0 WHERE port IS NULL");
}

export function ensureCookieJarCoalesceUniqueIndex(db: Database): void {
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_cookie_jar_identity
     ON cookie_jar(domain, COALESCE(port, 0), path, name)`,
  );
}
