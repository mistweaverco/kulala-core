import { mkdirSync } from "node:fs";
import { join } from "node:path";

if (process.env.npm_lifecycle_event === "install") {
  process.stdout.write("Skipping build during install");
  process.exit(0);
}

const root = import.meta.dir;
const distDir = join(root, "..", "dist");
mkdirSync(distDir, { recursive: true });

const entries = ["src/cli.ts", "src/postinstall.ts", "src/index.ts"] as const;

const result = await Bun.build({
  entrypoints: entries.map((entry) => join(root, "..", entry)),
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
