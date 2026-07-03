import { expect, test } from "bun:test";
import { join } from "node:path";

const HELPER_PATH = join(import.meta.dir, "index.ts");
const COUNT = 200;
const ITEM_SIZE = 2500;

/**
 * Regression test for stdout / stderr truncation past the kernel pipe
 * buffer when `process.exit` races a buffered Bun stdio write.
 *
 * The bug: `Bun.stdout.write(...); process.exit(0)` discards anything
 * still queued in the runtime's stdio buffer at the moment of exit. On
 * Linux a POSIX pipe holds at most ~64 KB synchronously, so result
 * wrappers larger than that are silently truncated when read by a
 * pipe consumer (e.g. kulala.nvim's `vim.system` bridge).
 *
 * `await Bun.write(Bun.stdout, ...)` fixes truncation for active readers
 * but deadlocks parents that use `spawnSync` (kulala-fmt) once the pipe
 * buffer fills. Use synchronous `writeSync` instead.
 *
 * These tests spawn a child process that calls the helper with a
 * ~500 KB payload, drain its stdio chunk-by-chunk, and assert that
 * every byte the helper intended to write was actually received.
 */

function buildPayload(type: string, pad: string): unknown {
  return {
    type,
    data: Array.from({ length: COUNT }, (_, i) => ({
      i,
      pad: pad.repeat(ITEM_SIZE),
    })),
  };
}

/** Child script - generates the payload in-process so the parent doesn't have
 *  to pass it via argv (avoids E2BIG for large payloads). */
function childScript(helperName: string, pad: string): string {
  return `
    import { ${helperName} } from "${HELPER_PATH}";
    const payload = {
      type: "${helperName === "writeRequestResponseToStderr" ? "error" : "responses"}",
      data: Array.from({ length: ${COUNT} }, (_, i) => ({
        i,
        pad: "${pad}".repeat(${ITEM_SIZE}),
      })),
    };
    await ${helperName}(payload);
  `;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) total += value.length;
  }
  return total;
}

test("writeRequestResponseToStdout flushes large payloads before exit", async () => {
  const expected = JSON.stringify(buildPayload("responses", "x"), null, 2);

  // sanity: payload must exceed the kernel pipe buffer to exercise the bug.
  expect(expected.length).toBeGreaterThan(65_536);

  const proc = Bun.spawn({
    cmd: ["bun", "-e", childScript("writeRequestResponseToStdout", "x")],
    stdout: "pipe",
    stderr: "inherit",
  });
  const received = await drain(proc.stdout);
  await proc.exited;

  expect(proc.exitCode).toBe(0);
  expect(received).toBe(expected.length);
});

test("writeToStdout flushes large payloads before the process exits", async () => {
  const expected = `${JSON.stringify(buildPayload("document", "z"), null, 2)}\n`;

  expect(expected.length).toBeGreaterThan(65_536);

  const proc = Bun.spawn({
    cmd: [
      "bun",
      "-e",
      `
    import { writeToStdout } from "${HELPER_PATH}";
    const payload = {
      type: "document",
      data: Array.from({ length: ${COUNT} }, (_, i) => ({
        i,
        pad: "z".repeat(${ITEM_SIZE}),
      })),
    };
    await writeToStdout(payload);
  `,
    ],
    stdout: "pipe",
    stderr: "inherit",
  });
  const received = await drain(proc.stdout);
  await proc.exited;

  expect(proc.exitCode).toBe(0);
  expect(received).toBe(expected.length);
});

test("writeRequestResponseToStderr flushes large payloads before exit", async () => {
  const expected = JSON.stringify(buildPayload("error", "y"), null, 2);

  expect(expected.length).toBeGreaterThan(65_536);

  const proc = Bun.spawn({
    cmd: ["bun", "-e", childScript("writeRequestResponseToStderr", "y")],
    stdout: "inherit",
    stderr: "pipe",
  });
  const received = await drain(proc.stderr);
  await proc.exited;

  expect(proc.exitCode).toBe(1);
  expect(received).toBe(expected.length);
});
