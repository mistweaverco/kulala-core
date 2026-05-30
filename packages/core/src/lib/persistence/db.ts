import { Database } from "bun:sqlite";
import { readFileSync, unlinkSync, writeFileSync } from "fs";
import { ensureDataDir } from "./data-dir";
import {
  getKeychainSecret,
  isKeychainAvailable,
  setKeychainSecret,
} from "./keychain";
import {
  decryptFileToPath,
  encrypt,
  encryptFileToPath,
  generateKey,
  isEncryptedFile,
  keyFromKeychain,
  keyToKeychainSecret,
} from "./encrypted-store";
import { runMigrations } from "./migrations/runner";

const DB_FILENAME = "kulala.db";
const DB_TEMP_SUFFIX = ".kulala.db.tmp";

let dbInstance: Database | null = null;
/** When using keychain: path we currently have open (real or temp). */
let openedDbPath: string | null = null;
let keychainMode = false;

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
  runMigrations(db);
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
    runMigrations(db);
    dbInstance = db;
    openedDbPath = tempPath;
  } else {
    const db = new Database(realPath, { create: true });
    runMigrations(db);
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
  if (dbInstance === null || !keychainMode || openedDbPath === null) {
    return false;
  }
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
 * For tests: open an in-memory database and run migrations.
 */
export function getDbInMemory(): Database {
  const db = new Database(":memory:", { create: true });
  runMigrations(db);
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
