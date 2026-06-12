import { spawn } from "node:child_process";
import { resolveJqPath } from "../runner/embedded-jq";

export type RunJqResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/**
 * Run a jq filter against the given input string.
 * Uses the bundled jq binary (or `KULALA_JQ_PATH` / system `jq`).
 */
export async function runJq(
  input: string,
  filter: string,
): Promise<RunJqResult> {
  const trimmedFilter = filter.trim();
  if (!trimmedFilter) {
    return { ok: false, error: "jq filter is empty" };
  }

  let jqPath: string;
  try {
    jqPath = await resolveJqPath();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return await new Promise<RunJqResult>((resolve) => {
    const child = spawn(jqPath, [trimmedFilter], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, output: stdout });
        return;
      }
      const message = stderr.trim() || `jq exited with code ${code ?? "?"}`;
      resolve({ ok: false, error: message });
    });
    child.stdin?.end(input, "utf8");
  });
}
