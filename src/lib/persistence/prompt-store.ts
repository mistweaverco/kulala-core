import { getDb } from "./db";
import { randomUUID } from "crypto";

export type PromptType =
  | "oauth2_authorization_code"
  | "oauth2_implicit_token"
  | "oauth2_device_code"
  | "custom";

export interface PromptContext {
  promptType: PromptType;
  [key: string]: unknown;
}

export interface PendingPrompt {
  id: string;
  promptType: PromptType;
  context: PromptContext;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Create a pending prompt and return its ID.
 * The context should contain all information needed to resume the operation.
 */
export function createPrompt(
  promptType: PromptType,
  context: PromptContext,
  expiresInSeconds?: number,
): string {
  const db = getDb();
  const id = randomUUID();
  const expiresAt = expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null;

  db.run(
    `INSERT INTO pending_prompts (id, prompt_type, context_json, expires_at)
     VALUES (?, ?, ?, ?)`,
    [id, promptType, JSON.stringify(context), expiresAt],
  );

  return id;
}

/**
 * Get a pending prompt by ID.
 * Returns null if not found or expired.
 */
export function getPrompt(id: string): PendingPrompt | null {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db
    .query<{
      id: string;
      prompt_type: string;
      context_json: string;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT id, prompt_type, context_json, created_at, expires_at
       FROM pending_prompts
       WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(id, now) as
    | {
        id: string;
        prompt_type: string;
        context_json: string;
        created_at: string;
        expires_at: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    promptType: row.prompt_type as PromptType,
    context: JSON.parse(row.context_json) as PromptContext,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

/**
 * Delete a pending prompt (after it's been used or cancelled).
 */
export function deletePrompt(id: string): void {
  const db = getDb();
  db.run("DELETE FROM pending_prompts WHERE id = ?", [id]);
}

/**
 * Clean up expired prompts.
 */
export function cleanupExpiredPrompts(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.run(
    "DELETE FROM pending_prompts WHERE expires_at IS NOT NULL AND expires_at <= ?",
    [now],
  );
  return result.changes;
}
