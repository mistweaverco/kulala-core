import { KulalaParser } from "./lib/parser";
import { existsSync, readFileSync } from "node:fs";
import { prepareWebSocketConnect } from "./lib/websocket/prepare-connect";
import { runWebSocketSession } from "./lib/websocket/websocket-session";

/**
 * Get input payload from multiple sources (in order of preference):
 * 1. File path passed as CLI argument (--input-file or -i)
 * 2. Environment variable KULALA_CORE_INPUT_FILE
 * 3. Stdin
 */
async function getInputPayload(): Promise<string> {
  const args = process.argv.slice(2);

  let inputFile: string | undefined;
  const inputFileIndex = args.findIndex(
    (arg) => arg === "--input-file" || arg === "-i",
  );
  if (inputFileIndex !== -1 && args[inputFileIndex + 1]) {
    inputFile = args[inputFileIndex + 1];
  }

  if (!inputFile && process.env.KULALA_CORE_INPUT_FILE) {
    inputFile = process.env.KULALA_CORE_INPUT_FILE;
  }

  if (inputFile) {
    if (!existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }
    return readFileSync(inputFile, { encoding: "utf-8" });
  }

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let content = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return content;
}

const args = process.argv.slice(2);
const wsFlagIndex = args.findIndex((a) => a === "--websocket");
if (wsFlagIndex !== -1) {
  let inputFile: string | undefined;
  const i = args.findIndex((a) => a === "--input-file" || a === "-i");
  if (i !== -1 && args[i + 1]) inputFile = args[i + 1];
  if (!inputFile && process.env.KULALA_CORE_INPUT_FILE) {
    inputFile = process.env.KULALA_CORE_INPUT_FILE;
  }
  if (!inputFile) {
    throw new Error("WebSocket mode requires --input-file with connect JSON");
  }
  const connect = JSON.parse(readFileSync(inputFile, { encoding: "utf-8" }));
  await runWebSocketSession(prepareWebSocketConnect(connect));
} else {
  const inputPayload = await getInputPayload();
  const stdIn = JSON.parse(inputPayload);

  KulalaParser.setInput(stdIn);
  await KulalaParser.parse();
}
