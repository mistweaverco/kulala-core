import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

if (process.env.npm_lifecycle_event === "install") {
  process.stdout.write("Skipping build during install");
  process.exit(0);
}

const root = import.meta.dir;
const distDir = join(root, "..", "dist");
mkdirSync(distDir, { recursive: true });

const entries = [
  { input: "src/cli.ts", output: "cli.js" },
  { input: "src/postinstall.ts", output: "install-backend.js" },
  { input: "src/index.ts", output: "index.js" },
] as const;

for (const entry of entries) {
  const result = await Bun.build({
    entrypoints: [join(root, "..", entry.input)],
    outdir: distDir,
    target: "node",
    format: "esm",
    minify: false,
    sourcemap: "none",
  });

  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }

  const builtName = entry.input.replace("src/", "").replace(".ts", ".js");
  if (builtName !== entry.output) {
    renameSync(join(distDir, builtName), join(distDir, entry.output));
  }
}

const typesResult = await Bun.spawn(
  ["bunx", "tsc", "-p", "tsconfig.build.json"],
  {
    cwd: join(root, ".."),
    stdout: "inherit",
    stderr: "inherit",
  },
).exited;

if (typesResult !== 0) {
  process.exit(typesResult);
}
