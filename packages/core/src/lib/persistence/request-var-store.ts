import { getDb } from "./db";
import type { PreviousResponse } from "../variables/request-vars";

function safeJsonParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Latest response per named request for VS Code REST Client-style {{NAME.response…}} vars.
 * Scoped to stable document id (same .http file).
 */
export function saveRequestVarResult(
  stableDocId: string,
  resultKey: string,
  response: PreviousResponse,
): void {
  const db = getDb();
  const bodyType = response.body.type;
  const bodyContent =
    bodyType === "json"
      ? JSON.stringify(response.body.content)
      : response.body.content;
  db.run(
    `INSERT INTO request_var_results
      (stable_doc_id, result_key, body_type, body_content, headers_json, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(stable_doc_id, result_key) DO UPDATE SET
       body_type = excluded.body_type,
       body_content = excluded.body_content,
       headers_json = excluded.headers_json,
       updated_at = excluded.updated_at`,
    [
      stableDocId,
      resultKey,
      bodyType,
      bodyContent,
      JSON.stringify(response.headers),
    ],
  );
}

export function loadRequestVarResults(
  stableDocId: string,
): Map<string, PreviousResponse> {
  const db = getDb();
  const rows = db
    .query<
      {
        result_key: string;
        body_type: string;
        body_content: string;
        headers_json: string | null;
      },
      [string]
    >(
      `SELECT result_key, body_type, body_content, headers_json
       FROM request_var_results
       WHERE stable_doc_id = ?`,
    )
    .all(stableDocId);

  const out = new Map<string, PreviousResponse>();
  for (const row of rows) {
    const headers =
      safeJsonParse<Record<string, string>>(row.headers_json) ?? {};
    const body =
      row.body_type === "json"
        ? {
            type: "json" as const,
            content: (safeJsonParse<Record<string, unknown>>(
              row.body_content,
            ) ?? {}) as Record<string, unknown>,
          }
        : {
            type: "text" as const,
            content: row.body_content,
          };
    out.set(row.result_key, { body, headers });
  }
  return out;
}

export function mergePersistedRequestVarResults(
  stableDocId: string,
  into: Map<string, PreviousResponse>,
): void {
  for (const [key, value] of loadRequestVarResults(stableDocId)) {
    if (!into.has(key)) into.set(key, value);
  }
}
