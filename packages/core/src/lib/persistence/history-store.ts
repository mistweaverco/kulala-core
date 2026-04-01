import { getDb } from "./db";

export type HistoryEntry = {
  id: number;
  stableDocId: string | null;
  blockName: string | null;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBodyText?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBodyText?: string;
  createdAt: string;
};

function safeJsonParse<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const MAX_BODY_CHARS = 1_000_000;
function clampBodyText(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s.length <= MAX_BODY_CHARS) return s;
  return s.slice(0, MAX_BODY_CHARS);
}

export function saveHistoryEntry(entry: {
  stableDocId?: string;
  blockName?: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBodyText?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBodyText?: string;
}): number {
  const db = getDb();
  const reqHeadersJson = entry.requestHeaders
    ? JSON.stringify(entry.requestHeaders)
    : null;
  const resHeadersJson = entry.responseHeaders
    ? JSON.stringify(entry.responseHeaders)
    : null;
  const reqBody = clampBodyText(entry.requestBodyText) ?? null;
  const resBody = clampBodyText(entry.responseBodyText) ?? null;

  const result = db.run(
    `INSERT INTO request_history
      (stable_doc_id, block_name, method, url, request_headers_json, request_body_text, status_code, response_headers_json, response_body_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.stableDocId ?? null,
      entry.blockName ?? null,
      entry.method,
      entry.url,
      reqHeadersJson,
      reqBody,
      entry.statusCode ?? null,
      resHeadersJson,
      resBody,
    ],
  );
  // bun:sqlite result has lastInsertRowid
  return Number(
    (result as unknown as { lastInsertRowid?: number }).lastInsertRowid ?? 0,
  );
}

export function listHistoryEntries(limit: number = 50): HistoryEntry[] {
  const db = getDb();
  const rows = db
    .query<
      {
        id: number;
        stable_doc_id: string | null;
        block_name: string | null;
        method: string;
        url: string;
        request_headers_json: string | null;
        request_body_text: string | null;
        status_code: number | null;
        response_headers_json: string | null;
        response_body_text: string | null;
        created_at: string;
      },
      [number]
    >(
      `SELECT id, stable_doc_id, block_name, method, url, request_headers_json, request_body_text,
              status_code, response_headers_json, response_body_text, created_at
       FROM request_history
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(limit);

  return rows.map((r) => ({
    id: r.id,
    stableDocId: r.stable_doc_id,
    blockName: r.block_name,
    method: r.method,
    url: r.url,
    requestHeaders: safeJsonParse<Record<string, string>>(
      r.request_headers_json,
    ),
    requestBodyText: r.request_body_text ?? undefined,
    statusCode: r.status_code ?? undefined,
    responseHeaders: safeJsonParse<Record<string, string>>(
      r.response_headers_json,
    ),
    responseBodyText: r.response_body_text ?? undefined,
    createdAt: r.created_at,
  }));
}
