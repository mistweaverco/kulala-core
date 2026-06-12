import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadDefaultCurlOptions } from "./default-curl-options";
import { mergeHttpClientEnvCatalog } from "./environments";

const tmpRoot = join(import.meta.dir, ".tmp-default-curl-options-test");

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("loadDefaultCurlOptions: merges $kulalaShared then per-env (closest wins)", () => {
  const root = join(tmpRoot, "nested");
  const child = join(root, "api");
  mkdirSync(child, { recursive: true });

  writeFileSync(
    join(root, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: {
        $kulalaDefaultCurlOptions: ["--insecure", "-n"],
      },
      dev: {
        $kulalaDefaultCurlOptions: ["--max-time 5"],
      },
    }),
  );
  writeFileSync(
    join(child, "http-client.env.json"),
    JSON.stringify({
      dev: {
        $kulalaDefaultCurlOptions: ["--max-time 10"],
      },
    }),
  );

  const argv = loadDefaultCurlOptions("dev", child);
  expect(argv).toEqual(["--insecure", "-n", "--max-time", "10"]);
});

test("loadDefaultCurlOptions: per-env overrides shared flag token", () => {
  const dir = join(tmpRoot, "override");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: {
        $kulalaDefaultCurlOptions: ["--max-time 30"],
      },
      dev: {
        $kulalaDefaultCurlOptions: ["--max-time 10"],
      },
    }),
  );

  expect(loadDefaultCurlOptions("dev", dir)).toEqual(["--max-time", "10"]);
});

test("loadDefaultCurlOptions: tokenizes quoted strings with spaces", () => {
  const dir = join(tmpRoot, "quoted");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      default: {
        $kulalaDefaultCurlOptions: ['--header "X-Foo: bar baz"'],
      },
    }),
  );

  expect(loadDefaultCurlOptions("default", dir)).toEqual([
    "--header",
    "X-Foo: bar baz",
  ]);
});

test("loadEnvVars: $kulalaDefaultCurlOptions are not exposed as env variables", async () => {
  const dir = join(tmpRoot, "vars");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      default: {
        $kulalaDefaultCurlOptions: ["--insecure"],
        MY_VAR: "value",
      },
    }),
  );

  const { loadEnvVars } = await import("./env-files");
  const vars = loadEnvVars("default", dir);
  expect(vars.MY_VAR).toBe("value");
  expect(vars["--insecure"]).toBeUndefined();
});

test("mergeHttpClientEnvCatalog: includes $kulalaDefaultCurlOptions in $kulalaShared", () => {
  const dir = join(tmpRoot, "catalog");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: {
        $kulalaDefaultCurlOptions: ["--insecure"],
      },
      dev: { API_URL: "https://dev.example" },
    }),
  );

  const catalog = mergeHttpClientEnvCatalog(dir);
  expect(catalog.$kulalaShared?.$kulalaDefaultCurlOptions).toEqual([
    "--insecure",
  ]);
});
