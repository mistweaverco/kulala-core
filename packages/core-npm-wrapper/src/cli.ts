#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { downloader } from "./lib/downloader";

async function main(): Promise<void> {
  const executable = await downloader.ensureInstalled();
  const result = spawnSync(executable, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
