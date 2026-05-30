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
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({ version: 1, name: "initial" });
});

test("runMigrations is idempotent", () => {
  const db = openMemoryDb();
  runMigrations(db);
  runMigrations(db);
  expect(getAppliedMigrations(db)).toHaveLength(1);
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

  expect(getAppliedMigrations(db)).toHaveLength(1);
  expect(db.query("SELECT 1 FROM documents LIMIT 1").get()).toBeNull();
});
