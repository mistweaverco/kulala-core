import type { KulalaPromptResponse } from "../../runner/types";

/**
 * Error thrown when OAuth2 flow requires user input via prompt system.
 * This error should be caught and converted to a KulalaPromptResponse.
 */
export class OAuth2PromptError extends Error {
  public readonly promptResponse: KulalaPromptResponse;

  constructor(promptResponse: KulalaPromptResponse) {
    super(`OAuth2 prompt required: ${promptResponse.promptId}`);
    this.name = "OAuth2PromptError";
    this.promptResponse = promptResponse;
  }
}
