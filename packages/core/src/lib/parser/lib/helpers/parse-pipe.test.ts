import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { getDocument } from "../../parser";

const FIXTURE_DIR = join(import.meta.dir, "fixtures");
const HTTP_FIXTURE = join(FIXTURE_DIR, "large-pipe-parse.http");
const GOLDEN_FIXTURE = join(FIXTURE_DIR, "large-pipe-parse.golden.json");
const CLI_PATH = join(import.meta.dir, "../../../../cli.ts");
const STABLE_FILEPATH = "/fixtures/large-pipe-parse.http";

async function expectedParseStdout(): Promise<string> {
  const content = await Bun.file(HTTP_FIXTURE).text();
  const doc = await getDocument(content, STABLE_FILEPATH);
  return `${JSON.stringify(doc, null, 2)}\n`;
}

async function readGolden(): Promise<string> {
  const goldenFile = Bun.file(GOLDEN_FIXTURE);
  if (!(await goldenFile.exists())) {
    throw new Error(
      `Missing golden file ${GOLDEN_FIXTURE}. Run: UPDATE_GOLDEN=1 bun test parse-pipe`,
    );
  }
  return goldenFile.text();
}

/**
 * Regression test for large `action: "parse"` payloads truncated when
 * kulala-core stdout is connected to a pipe (e.g. kulala.nvim's
 * `vim.system` bridge). Output must exceed the kernel pipe buffer (~64 KB).
 *
 * Golden file: run `bun test --update-golden parse-pipe` after intentional
 * parser output changes.
 */
test("parse action flushes large document JSON through a pipe", async () => {
  const content = await Bun.file(HTTP_FIXTURE).text();
  const golden = await readGolden().catch(async (error) => {
    if (process.env.UPDATE_GOLDEN !== "1") throw error;
    const expected = await expectedParseStdout();
    await Bun.write(GOLDEN_FIXTURE, expected);
    return expected;
  });

  expect(golden.length).toBeGreaterThan(65_536);

  const payload = JSON.stringify({
    action: "parse",
    content,
    filepath: STABLE_FILEPATH,
  });

  const proc = Bun.spawn({
    cmd: ["bun", CLI_PATH],
    cwd: join(import.meta.dir, "../../../.."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(`${payload}\n`);
  proc.stdin.end();

  const received = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (process.env.UPDATE_GOLDEN === "1") {
    await Bun.write(GOLDEN_FIXTURE, received);
  }

  expect(proc.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(received.length).toBe(golden.length);
  expect(received).toBe(golden);
});

test("parse action completes under Node spawnSync (kulala-fmt bridge)", async () => {
  const content = await Bun.file(HTTP_FIXTURE).text();
  const golden = await readGolden();
  const payload = JSON.stringify({
    action: "parse",
    content,
    filepath: STABLE_FILEPATH,
  });

  const result = spawnSync("bun", [CLI_PATH], {
    cwd: join(import.meta.dir, "../../../.."),
    input: `${payload}\n`,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(golden);
});

test("golden file matches getDocument output", async () => {
  const golden = await readGolden().catch(async (error) => {
    if (process.env.UPDATE_GOLDEN !== "1") throw error;
    const expected = await expectedParseStdout();
    await Bun.write(GOLDEN_FIXTURE, expected);
    return expected;
  });
  const expected = await expectedParseStdout();

  if (process.env.UPDATE_GOLDEN === "1") {
    await Bun.write(GOLDEN_FIXTURE, expected);
  }

  expect(expected).toBe(golden);
});
