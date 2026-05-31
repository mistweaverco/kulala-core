import { join } from "path";

/** Repo-root `http-example-files/` (stable regardless of `process.cwd()`). */
export const httpExamplesDir = join(
  import.meta.dir,
  "../../../../http-example-files",
);
