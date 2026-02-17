import type { KulalaDocument } from "../parser/types";
import { getDb } from "./db";

/**
 * Optional content hash (e.g. hash of raw file content) for cache invalidation.
 * If provided and different from stored hash, the document is updated.
 */
export function saveDocument(doc: KulalaDocument, contentHash?: string): void {
  const filepath = doc.filepath ?? "";
  const db = getDb();
  const parsedJson = JSON.stringify(doc);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO documents (filepath, content_hash, parsed_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(filepath) DO UPDATE SET
       content_hash = excluded.content_hash,
       parsed_json = excluded.parsed_json,
       updated_at = excluded.updated_at`,
    [filepath, contentHash ?? null, parsedJson, now, now],
  );
}

/**
 * Load a parsed document by filepath. Returns null if not found.
 */
export function loadDocument(filepath: string): KulalaDocument | null {
  const db = getDb();
  const row = db
    .query<
      { parsed_json: string },
      [string]
    >("SELECT parsed_json FROM documents WHERE filepath = ?")
    .get(filepath);
  if (!row) return null;
  try {
    return JSON.parse(row.parsed_json) as KulalaDocument;
  } catch {
    return null;
  }
}

/**
 * List all stored document filepaths.
 */
export function listDocumentFilepaths(): string[] {
  const db = getDb();
  const rows = db
    .query<{ filepath: string }, []>("SELECT filepath FROM documents")
    .all();
  return rows.map((r) => r.filepath);
}
