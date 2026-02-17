import { getDb } from "./db";

export type RequestRun = {
  documentFilepath: string;
  blockName: string;
  runCount: number;
  lastRunAt: string | null;
};

/**
 * Increment replay count for a request block and return the new count.
 */
export function incrementReplayCount(
  documentFilepath: string,
  blockName: string,
): number {
  const db = getDb();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO request_runs (document_filepath, block_name, run_count, last_run_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(document_filepath, block_name) DO UPDATE SET
       run_count = run_count + 1,
       last_run_at = excluded.last_run_at`,
    [documentFilepath, blockName, now],
  );

  const row = db
    .query<
      { run_count: number },
      [string, string]
    >("SELECT run_count FROM request_runs WHERE document_filepath = ? AND block_name = ?")
    .get(documentFilepath, blockName);
  return row?.run_count ?? 0;
}

/**
 * Get replay count and last run time for a request block.
 */
export function getReplayCount(
  documentFilepath: string,
  blockName: string,
): RequestRun | null {
  const db = getDb();
  const row = db
    .query<
      {
        document_filepath: string;
        block_name: string;
        run_count: number;
        last_run_at: string | null;
      },
      [string, string]
    >(
      "SELECT document_filepath, block_name, run_count, last_run_at FROM request_runs WHERE document_filepath = ? AND block_name = ?",
    )
    .get(documentFilepath, blockName);
  if (!row) return null;
  return {
    documentFilepath: row.document_filepath,
    blockName: row.block_name,
    runCount: row.run_count,
    lastRunAt: row.last_run_at,
  };
}

/**
 * List all request runs for a document (or all documents if filepath omitted).
 */
export function listRequestRuns(documentFilepath?: string): RequestRun[] {
  const db = getDb();
  const sql = documentFilepath
    ? "SELECT document_filepath, block_name, run_count, last_run_at FROM request_runs WHERE document_filepath = ? ORDER BY last_run_at DESC"
    : "SELECT document_filepath, block_name, run_count, last_run_at FROM request_runs ORDER BY last_run_at DESC";
  const rows = documentFilepath
    ? db
        .query<
          {
            document_filepath: string;
            block_name: string;
            run_count: number;
            last_run_at: string | null;
          },
          [string]
        >(sql)
        .all(documentFilepath)
    : db
        .query<
          {
            document_filepath: string;
            block_name: string;
            run_count: number;
            last_run_at: string | null;
          },
          []
        >(sql)
        .all();

  return rows.map((r) => ({
    documentFilepath: r.document_filepath,
    blockName: r.block_name,
    runCount: r.run_count,
    lastRunAt: r.last_run_at,
  }));
}
