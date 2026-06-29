import { writeSync } from "node:fs";
import type { KulalaDocument, KulalaStdinParsed } from "../../types";

/** Normalize CRLF and lone CR to LF so block regexes and line splitting work consistently. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isEagain(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EAGAIN"
  );
}

/** Synchronous stdio write - avoids Bun async stdout deadlocks with `spawnSync` parents. */
export function writePayloadToFd(
  fd: number,
  payload: unknown,
  trailingNewline = false,
): void {
  const text = JSON.stringify(payload, null, 2) + (trailingNewline ? "\n" : "");
  const buffer = Buffer.from(text);
  let offset = 0;
  while (offset < buffer.length) {
    try {
      const written = writeSync(fd, buffer, offset, buffer.length - offset);
      if (written <= 0) {
        throw new Error(`failed to write payload to fd ${fd}`);
      }
      offset += written;
    } catch (error) {
      if (isEagain(error)) {
        continue;
      }
      throw error;
    }
  }
}

export const writeRequestResponseToStderr = async (
  res: unknown,
): Promise<void> => {
  writePayloadToFd(2, res);
  process.exit(1);
};

/** Write a kulala-core error message to stderr (same shape as runner errors, does not exit). */
export const writeErrorToStderr = (error: string): void => {
  writePayloadToFd(2, { success: false, error }, true);
};

export const writeRequestResponseToStdout = async (
  res: unknown,
): Promise<void> => {
  writePayloadToFd(1, res);
  process.exit(0);
};

export const writeToStderr = (doc: KulalaDocument): void => {
  writePayloadToFd(2, doc, true);
};

export const writeToStdout = async (payload: unknown): Promise<void> => {
  writePayloadToFd(1, payload, true);
};

export const getAllContentsFromStdinAtOnce =
  async (): Promise<KulalaStdinParsed> => {
    const reader = Bun.stdin.stream().getReader();
    let content = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunkText = new TextDecoder().decode(value);
      content += chunkText;
    }
    reader.releaseLock();

    return JSON.parse(content) as unknown as KulalaStdinParsed;
  };

export const pad = (
  num: number | string,
  size: number,
  padWith: string = "0",
): string => {
  let s = num.toString();
  while (s.length < size) s = padWith + s;
  return s;
};
