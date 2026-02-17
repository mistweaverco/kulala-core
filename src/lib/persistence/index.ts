/**
 * Persistence layer for Kulala: SQLite-backed storage in an OS-specific data directory.
 *
 * - Documents: parsed HTTP documents for replay (by filepath).
 * - Request runs: replay count per request block.
 * - Variables: global, per-document, or per-request.
 *
 * Data directory:
 * - Linux: $XDG_DATA_HOME/kulala (~/.local/share/kulala)
 * - macOS: ~/Library/Application Support/kulala
 * - Windows: %APPDATA%/kulala
 *
 * Future: optional OS keychain lock/unlock for the DB (see issue #6).
 */

export { getDataDir, ensureDataDir } from "./data-dir";
export { getDb, closeDb, getDbInMemory, setDbForTesting } from "./db";
export {
  saveDocument,
  loadDocument,
  listDocumentFilepaths,
} from "./document-store";
export {
  incrementReplayCount,
  getReplayCount,
  listRequestRuns,
  type RequestRun,
} from "./replay-store";
export {
  setVariable,
  getVariable,
  getVariables,
  deleteVariable,
  type VariableScope,
} from "./variable-store";
