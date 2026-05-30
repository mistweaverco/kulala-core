#!/usr/bin/env bun
/**
 * Apply pending migrations to the on-disk Kulala DB (same path as getDb()).
 * Mostly used for manual inspection ...
 */
import { closeDb, getAppliedMigrations, getDb } from "../src/lib/persistence";

const db = getDb();
const before = getAppliedMigrations(db).length;
// getDb() already migrated; re-export for explicit status
const after = getAppliedMigrations(db);
closeDb();

console.log(
  `Migrations: ${after.length} applied${after.length > before ? ` (+${after.length - before} new)` : ""}`,
);
for (const row of after) {
  console.log(`  ${row.version} ${row.name} @ ${row.applied_at}`);
}
