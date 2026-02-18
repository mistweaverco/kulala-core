import { Database } from "bun:sqlite";
import { unlinkSync, readFileSync, writeFileSync } from "fs";
import { ensureDataDir } from "./data-dir";
import {
  getKeychainSecret,
  setKeychainSecret,
  isKeychainAvailable,
} from "./keychain";
import {
  isEncryptedFile,
  encryptFileToPath,
  decryptFileToPath,
  encrypt,
  generateKey,
  keyToKeychainSecret,
  keyFromKeychain,
} from "./encrypted-store";

const DB_FILENAME = "kulala.db";
const DB_TEMP_SUFFIX = ".kulala.db.tmp";

let dbInstance: Database | null = null;
/** When using keychain: path we currently have open (real or temp). */
let openedDbPath: string | null = null;
let keychainMode = false;

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

-- Pending prompts for user input (OAuth2, etc.)
CREATE TABLE IF NOT EXISTS pending_prompts (
  id TEXT PRIMARY KEY,
  prompt_type TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_request_runs_doc ON request_runs(document_filepath);
CREATE INDEX IF NOT EXISTS idx_variables_scope ON variables(scope, scope_document, scope_block_name);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_type ON pending_prompts(prompt_type);
CREATE INDEX IF NOT EXISTS idx_pending_prompts_expires ON pending_prompts(expires_at);
`;

/**
 * Opens the Kulala SQLite database in the OS-specific data directory,
 * creating the directory and schema if needed.
 * Uses a single shared instance.
 *
 * Graceful fallback: if you never call unlockDb(), the DB is used unencrypted
 * (plain SQLite file). When keychain is unavailable, getDb() also opens
 * unencrypted. Encryption is only used when unlockDb()/lockDb() are used.
 * If the DB was previously locked via keychain, call unlockDb() first.
 */
export function getDb(): Database {
  if (dbInstance !== null) {
    return dbInstance;
  }
  if (keychainMode && openedDbPath === null) {
    throw new Error("DB is locked (keychain). Call unlockDb() first.");
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
 * Does not encrypt; use lockDb() for keychain lock.
 */
export function closeDb(): void {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
  openedDbPath = null;
  keychainMode = false;
}

/**
 * Unlock the DB using the OS keychain (macOS Keychain, Linux Secret Service).
 * Gets the encryption key from the keychain; if the DB file is encrypted, decrypts to a temp file and opens it.
 * If no key exists yet, generates one and stores it (DB will be encrypted on first lock).
 * Resolves to true if unlocked, false if keychain is not available or key retrieval failed.
 */
export async function unlockDb(): Promise<boolean> {
  if (!isKeychainAvailable()) return false;
  if (dbInstance !== null) return true; // already open
  const dataDir = ensureDataDir();
  const realPath = `${dataDir}/${DB_FILENAME}`;
  let key = await getKeychainSecret();
  if (key === null) {
    const newKey = generateKey();
    const secret = keyToKeychainSecret(newKey);
    if (!(await setKeychainSecret(secret))) return false;
    key = secret;
  }
  if (isEncryptedFile(realPath)) {
    const tempPath = `${dataDir}/${DB_FILENAME}${DB_TEMP_SUFFIX}`;
    const ok = await decryptFileToPath(realPath, tempPath, key);
    if (!ok) return false;
    const db = new Database(tempPath, { create: false });
    db.run(SCHEMA);
    dbInstance = db;
    openedDbPath = tempPath;
  } else {
    const db = new Database(realPath, { create: true });
    db.run(SCHEMA);
    dbInstance = db;
    openedDbPath = realPath;
  }
  keychainMode = true;
  return true;
}

/**
 * Lock the DB: close it and encrypt the file using the key from the OS keychain.
 * Only has an effect when the DB was opened via unlockDb().
 */
export async function lockDb(): Promise<boolean> {
  if (dbInstance === null || !keychainMode || openedDbPath === null)
    return false;
  const dataDir = ensureDataDir();
  const realPath = `${dataDir}/${DB_FILENAME}`;
  const key = await getKeychainSecret();
  if (key === null) return false;
  dbInstance.close();
  dbInstance = null;
  try {
    const keyBuf = keyFromKeychain(key);
    if (openedDbPath === realPath) {
      const data = readFileSync(realPath);
      const encrypted = encrypt(data, keyBuf);
      writeFileSync(realPath, encrypted);
    } else {
      await encryptFileToPath(openedDbPath, realPath, key);
      unlinkSync(openedDbPath);
    }
  } finally {
    openedDbPath = null;
    keychainMode = false;
  }
  return true;
}

/** Whether the DB is currently unlocked with keychain (open and using keychain). */
export function isUnlockedWithKeychain(): boolean {
  return keychainMode && dbInstance !== null;
}

/** Whether the OS keychain is available on this platform. */
export { isKeychainAvailable };

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
  openedDbPath = null;
  keychainMode = false;
}
