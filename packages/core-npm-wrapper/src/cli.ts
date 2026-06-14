#!/usr/bin/env node

import { spawn } from "node:child_process";
import { downloader } from "./lib/downloader";

async function main(): Promise<void> {
  const executable =
    downloader.resolveExecutableSync() ?? (await downloader.ensureInstalled());

  const child = spawn(executable, process.argv.slice(2), {
    stdio: [process.stdin, process.stdout, process.stderr],
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
