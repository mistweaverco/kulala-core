import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const MAGIC = Buffer.from("KULALA_ENC_V1", "utf8");

function keyFromKeychain(keychainSecret: string): Buffer {
  const buf = Buffer.from(keychainSecret, "base64");
  if (buf.length !== KEY_LEN) {
    throw new Error("Invalid key length from keychain");
  }
  return buf;
}

function generateKey(): Buffer {
  return randomBytes(KEY_LEN);
}

/**
 * Encrypt data with AES-256-GCM. Format: magic (12) + iv (12) + tag (16) + ciphertext.
 */
export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, encrypted]);
}

/**
 * Decrypt data. Returns null if format is invalid or decryption fails.
 */
export function decrypt(encrypted: Buffer, key: Buffer): Buffer | null {
  if (encrypted.length < MAGIC.length + IV_LEN + TAG_LEN) return null;
  if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const iv = encrypted.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = encrypted.subarray(
    MAGIC.length + IV_LEN,
    MAGIC.length + IV_LEN + TAG_LEN,
  );
  const ciphertext = encrypted.subarray(MAGIC.length + IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

export function isEncryptedFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const buf = readFileSync(path);
  return (
    buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC)
  );
}

export async function encryptFileToPath(
  sourcePath: string,
  destPath: string,
  keychainSecret: string,
): Promise<void> {
  const key = keyFromKeychain(keychainSecret);
  const data = readFileSync(sourcePath);
  const encrypted = encrypt(data, key);
  writeFileSync(destPath, encrypted);
}

export async function decryptFileToPath(
  sourcePath: string,
  destPath: string,
  keychainSecret: string,
): Promise<boolean> {
  const key = keyFromKeychain(keychainSecret);
  const data = readFileSync(sourcePath);
  const decrypted = decrypt(data, key);
  if (decrypted === null) return false;
  writeFileSync(destPath, decrypted);
  return true;
}

export { generateKey, keyFromKeychain, KEY_LEN };
export function keyToKeychainSecret(key: Buffer): string {
  return key.toString("base64");
}
