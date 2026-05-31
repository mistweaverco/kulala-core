import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { getAppliedMigrations, runMigrations } from "./runner";

function openMemoryDb(): Database {
  return new Database(":memory:", { create: true });
}

afterEach(() => {
  // no shared state
});

test("runMigrations creates app tables and records baseline", () => {
  const db = openMemoryDb();
  runMigrations(db);

  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((r) => r.name);

  expect(tables).toContain("documents");
  expect(tables).toContain("schema_migrations");

  const applied = getAppliedMigrations(db);
  expect(applied).toHaveLength(3);
  expect(applied[0]).toMatchObject({ version: 1, name: "initial" });
  expect(applied[1]).toMatchObject({ version: 2, name: "graphql_schemas" });
  expect(applied[2]).toMatchObject({ version: 3, name: "cookie_jar_port" });
  expect(tables).toContain("graphql_schemas");
});

test("runMigrations is idempotent", () => {
  const db = openMemoryDb();
  runMigrations(db);
  runMigrations(db);
  expect(getAppliedMigrations(db)).toHaveLength(3);
});

test("runMigrations on pre-migration DB that already has tables", () => {
  const db = openMemoryDb();
  db.run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath TEXT NOT NULL,
    parsed_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(filepath)
  )`);

  runMigrations(db);

  expect(getAppliedMigrations(db)).toHaveLength(3);
  expect(db.query("SELECT 1 FROM documents LIMIT 1").get()).toBeNull();
});

test("runMigrations upgrades legacy cookie_jar without port column", () => {
  const db = openMemoryDb();
  db.run(`CREATE TABLE cookie_jar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TEXT,
    secure INTEGER NOT NULL DEFAULT 0,
    http_only INTEGER NOT NULL DEFAULT 0,
    same_site TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(domain, path, name)
  )`);
  db.run(
    "INSERT INTO cookie_jar (domain, path, name, value) VALUES ('example.com', '/', 'sid', 'abc')",
  );

  runMigrations(db);

  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(cookie_jar)")
    .all()
    .map((r) => r.name);
  expect(cols).toContain("port");

  const row = db
    .query<
      { domain: string; port: number | null; name: string },
      []
    >("SELECT domain, port, name FROM cookie_jar")
    .get();
  expect(row).toEqual({ domain: "example.com", port: null, name: "sid" });

  expect(getAppliedMigrations(db)).toHaveLength(3);
});
