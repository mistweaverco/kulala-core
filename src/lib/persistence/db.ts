import { Database } from "bun:sqlite";
import { ensureDataDir } from "./data-dir";

const DB_FILENAME = "kulala.db";

let dbInstance: Database | null = null;

const SCHEMA = `
-- Parsed HTTP documents for replay (keyed by filepath, optional content hash for cache invalidation).
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath TEXT NOT NULL,
  content_hash TEXT,
  parsed_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(filepath)
);

-- Replay count per request block.
CREATE TABLE IF NOT EXISTS request_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_filepath TEXT NOT NULL,
  block_name TEXT NOT NULL,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  UNIQUE(document_filepath, block_name)
);

-- Variables: global, per-document, or per-request.
CREATE TABLE IF NOT EXISTS variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK(scope IN ('global','document','request')),
  name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  scope_document TEXT,
  scope_block_name TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(scope, name, scope_document, scope_block_name)
);

CREATE INDEX IF NOT EXISTS idx_request_runs_doc ON request_runs(document_filepath);
CREATE INDEX IF NOT EXISTS idx_variables_scope ON variables(scope, scope_document, scope_block_name);
`;

/**
 * Opens the Kulala SQLite database in the OS-specific data directory,
 * creating the directory and schema if needed.
 * Uses a single shared instance.
 */
export function getDb(): Database {
  if (dbInstance !== null) {
    return dbInstance;
  }
  const dataDir = ensureDataDir();
  const dbPath = `${dataDir}/${DB_FILENAME}`;
  const db = new Database(dbPath, { create: true });
  db.run(SCHEMA);
  dbInstance = db;
  return db;
}

/**
 * Close the database connection. Useful for tests or graceful shutdown.
 */
export function closeDb(): void {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * For tests: open an in-memory database and run schema.
 */
export function getDbInMemory(): Database {
  const db = new Database(":memory:", { create: true });
  db.run(SCHEMA);
  return db;
}

/**
 * For tests: replace the shared DB instance (e.g. with in-memory).
 * Call closeDb() or setDbForTesting(newDb) to restore normal behavior.
 */
export function setDbForTesting(database: Database): void {
  if (dbInstance !== null) {
    dbInstance.close();
  }
  dbInstance = database;
}
