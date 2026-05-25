import type { KulalaPromptResponse } from "./types";

/**
 * Thrown when a pre-request script calls `$kulala.prompt()` and the variable is not set.
 * Catch upstream and return `promptResponse` to the client (same as OAuth2 prompts).
 */
export class ScriptPromptError extends Error {
  public readonly promptResponse: KulalaPromptResponse;

  constructor(promptResponse: KulalaPromptResponse) {
    super(`Script prompt required: ${promptResponse.promptId}`);
    this.name = "ScriptPromptError";
    this.promptResponse = promptResponse;
  }
}
