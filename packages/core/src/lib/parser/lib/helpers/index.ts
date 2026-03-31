import type { KulalaDocument, KulalaStdinParsed } from "../../types";

export const writeRequestResponseToStderr = (res: unknown): void => {
  Bun.stderr.write(JSON.stringify(res, null, 2));
  process.exit(1);
};

/** Write a kulala-core error message to stderr (same shape as runner errors, does not exit). */
export const writeErrorToStderr = (error: string): void => {
  Bun.stderr.write(JSON.stringify({ success: false, error }, null, 2) + "\n");
};

export const writeRequestResponseToStdout = (res: unknown): void => {
  Bun.stdout.write(JSON.stringify(res, null, 2));
  process.exit(0);
};

export const writeToStderr = (doc: KulalaDocument): void => {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(doc, null, 2) + "\n");
  Bun.stderr.write(JSON.stringify(data, null, 2));
};

export const writeToStdout = (doc: KulalaDocument): void => {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(doc, null, 2) + "\n");
  Bun.stdout.write(data);
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
