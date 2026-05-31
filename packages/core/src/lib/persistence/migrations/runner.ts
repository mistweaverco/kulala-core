import type { Database } from "bun:sqlite";
import { MIGRATIONS, type Migration } from "./index";

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export type AppliedMigration = {
  version: number;
  name: string;
  applied_at: string;
};

function ensureMigrationsTable(db: Database): void {
  db.run(MIGRATIONS_TABLE);
}

export function getAppliedMigrations(db: Database): AppliedMigration[] {
  ensureMigrationsTable(db);
  return db
    .query<
      AppliedMigration,
      []
    >("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
    .all();
}

function getAppliedVersions(db: Database): Set<number> {
  return new Set(getAppliedMigrations(db).map((row) => row.version));
}

function applyMigration(db: Database, migration: Migration): void {
  migration.apply?.(db);
  for (const stmt of migration.statements) {
    db.run(stmt);
  }
  db.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
    migration.version,
    migration.name,
  ]);
}

/**
 * Applies any pending migrations in version order. Safe to call on every DB open.
 */
export function runMigrations(db: Database): void {
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return;

  const applyOne = db.transaction((migration: Migration) => {
    applyMigration(db, migration);
  });

  for (const migration of pending) {
    applyOne(migration);
  }
}
