/**
 * Baseline schema. Uses IF NOT EXISTS so existing databases created before
 * migrations are recorded still apply cleanly on first migrate.
 */
export const migration000001Initial = {
  version: 1,
  name: "initial",
  statements: [
    `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath TEXT NOT NULL,
    content_hash TEXT,
    parsed_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(filepath)
  )`,
    `CREATE TABLE IF NOT EXISTS request_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_doc_id TEXT,
    block_name TEXT,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    request_headers_json TEXT,
    request_body_text TEXT,
    status_code INTEGER,
    response_headers_json TEXT,
    response_body_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    `CREATE TABLE IF NOT EXISTS cookie_jar (
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
  )`,
    `CREATE TABLE IF NOT EXISTS request_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_filepath TEXT NOT NULL,
    block_name TEXT NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TEXT,
    UNIQUE(document_filepath, block_name)
  )`,
    `CREATE TABLE IF NOT EXISTS variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK(scope IN ('global','document','request')),
    name TEXT NOT NULL,
    value_json TEXT NOT NULL,
    scope_document TEXT,
    scope_block_name TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(scope, name, scope_document, scope_block_name)
  )`,
    `CREATE TABLE IF NOT EXISTS pending_prompts (
    id TEXT PRIMARY KEY,
    prompt_type TEXT NOT NULL,
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    UNIQUE(id)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_request_runs_doc ON request_runs(document_filepath)`,
    `CREATE INDEX IF NOT EXISTS idx_variables_scope ON variables(scope, scope_document, scope_block_name)`,
    `CREATE INDEX IF NOT EXISTS idx_pending_prompts_type ON pending_prompts(prompt_type)`,
    `CREATE INDEX IF NOT EXISTS idx_pending_prompts_expires ON pending_prompts(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_request_history_created ON request_history(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_request_history_doc_block ON request_history(stable_doc_id, block_name)`,
    `CREATE TABLE IF NOT EXISTS request_var_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_doc_id TEXT NOT NULL,
    result_key TEXT NOT NULL,
    body_type TEXT NOT NULL CHECK(body_type IN ('json', 'text')),
    body_content TEXT NOT NULL,
    headers_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(stable_doc_id, result_key)
  )`,
    `CREATE INDEX IF NOT EXISTS idx_request_var_results_doc ON request_var_results(stable_doc_id)`,
    // cookie_jar index is created in 000003 after legacy DBs gain the `port` column
  ],
} as const;
