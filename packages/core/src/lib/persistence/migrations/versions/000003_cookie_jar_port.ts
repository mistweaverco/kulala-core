import type { Database } from "bun:sqlite";

function cookieJarHasPortColumn(db: Database): boolean {
  const rows = db
    .query<{ name: string }, []>("PRAGMA table_info(cookie_jar)")
    .all();
  return rows.some((r) => r.name === "port");
}

/**
 * Legacy kulala.db files created before cookie port scoping used
 * UNIQUE(domain, path, name) without a `port` column. CREATE TABLE IF NOT EXISTS
 * in 000001 does not alter existing tables, so we rebuild cookie_jar when needed.
 */
function upgradeCookieJarPort(db: Database): void {
  const table = db
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cookie_jar'")
    .get();
  if (!table) return;
  if (cookieJarHasPortColumn(db)) return;

  db.run(`CREATE TABLE cookie_jar_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    port INTEGER,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT,
    secure INTEGER NOT NULL DEFAULT 0,
    http_only INTEGER NOT NULL DEFAULT 0,
    same_site TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(domain, port, path, name)
  )`);

  db.run(`INSERT INTO cookie_jar_new (
    id, domain, port, path, name, value, expires_at, secure, http_only, same_site, updated_at
  )
  SELECT
    id, domain, NULL, path, name, value, expires_at, secure, http_only, same_site, updated_at
  FROM cookie_jar`);

  db.run("DROP TABLE cookie_jar");
  db.run("ALTER TABLE cookie_jar_new RENAME TO cookie_jar");
}

export const migration000003CookieJarPort = {
  version: 3,
  name: "cookie_jar_port",
  statements: [
    `CREATE INDEX IF NOT EXISTS idx_cookie_jar_domain_path ON cookie_jar(domain, port, path)`,
  ] as const,
  apply(db: Database): void {
    upgradeCookieJarPort(db);
  },
} as const;
