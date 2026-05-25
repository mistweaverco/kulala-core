/** Pre-request script asked to skip sending this request (JetBrains `request.skip()`). */
export class ScriptSkipError extends Error {
  override name = "ScriptSkipError";
  constructor() {
    super("Request skipped by script");
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
