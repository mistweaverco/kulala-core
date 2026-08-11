/** Pre-request script asked to skip sending this request (JetBrains `request.skip()`). */
export class ScriptSkipError extends Error {
  override name = "ScriptSkipError";
  constructor(message?: string) {
    super(
      typeof message === "string" && message.trim().length > 0
        ? message
        : "Request skipped by script",
    );
  }
}

/** Pre-request script asked to abort sending this request (failure, not soft skip). */
export class ScriptAbortError extends Error {
  override name = "ScriptAbortError";
  constructor(message?: string) {
    super(
      typeof message === "string" && message.trim().length > 0
        ? message
        : "Request aborted by script",
    );
  }
}

/** Script asked to re-run this request (JetBrains `request.replay()`). */
export class ScriptReplayError extends Error {
  override name = "ScriptReplayError";
  constructor() {
    super("Request replay requested by script");
  }
}

export const MAX_SCRIPT_REPLAYS = 32;
