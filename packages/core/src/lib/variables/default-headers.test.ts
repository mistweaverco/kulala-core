import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { applyDefaultHeaders, loadDefaultHeaders } from "./default-headers";
import { mergeHttpClientEnvCatalog } from "./environments";

const tmpRoot = join(import.meta.dir, ".tmp-default-headers-test");

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("loadDefaultHeaders: merges $kulalaShared then per-env (closest wins)", () => {
  const root = join(tmpRoot, "nested");
  const child = join(root, "api");
  mkdirSync(child, { recursive: true });

  writeFileSync(
    join(root, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: {
        $kulalaDefaultHeaders: {
          "X-Shared": "root",
          Accept: "application/json",
        },
      },
      dev: {
        $kulalaDefaultHeaders: { "X-Env": "root-dev" },
        API_URL: "https://example.com",
      },
    }),
  );
  writeFileSync(
    join(child, "http-client.env.json"),
    JSON.stringify({
      dev: {
        $kulalaDefaultHeaders: {
          "X-Env": "child-dev",
          "Content-Type": "text/plain",
        },
      },
    }),
  );

  const headers = loadDefaultHeaders("dev", child);
  expect(headers["X-Shared"]).toBe("root");
  expect(headers.Accept).toBe("application/json");
  expect(headers["X-Env"]).toBe("child-dev");
  expect(headers["Content-Type"]).toBe("text/plain");
});

test("loadEnvVars: merges $kulalaShared variables into every environment", async () => {
  const dir = join(tmpRoot, "shared-vars");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: {
        API_URL: "https://shared.example",
        $kulalaDefaultHeaders: { "X-Test": "hdr" },
      },
      dev: { TOKEN: "dev-token" },
      prod: { TOKEN: "prod-token" },
    }),
  );

  const { loadEnvVars } = await import("./env-files");
  const dev = loadEnvVars("dev", dir);
  const prod = loadEnvVars("prod", dir);
  expect(dev.API_URL).toBe("https://shared.example");
  expect(dev.TOKEN).toBe("dev-token");
  expect(prod.API_URL).toBe("https://shared.example");
  expect(prod.TOKEN).toBe("prod-token");
});

test("loadDefaultHeaders: $kulalaDefaultHeaders are not exposed as env variables", async () => {
  const dir = join(tmpRoot, "vars");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      default: {
        $kulalaDefaultHeaders: { "X-Test": "hdr" },
        MY_VAR: "value",
      },
    }),
  );

  const { loadEnvVars } = await import("./env-files");
  const vars = loadEnvVars("default", dir);
  expect(vars.MY_VAR).toBe("value");
  expect(vars["X-Test"]).toBeUndefined();
  expect(vars["$kulalaDefaultHeaders.X-Test"]).toBeUndefined();
});

test("mergeHttpClientEnvCatalog: includes $kulalaShared", () => {
  const dir = join(tmpRoot, "catalog");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: { $kulalaDefaultHeaders: { Accept: "application/json" } },
      dev: { API_URL: "https://dev.example" },
    }),
  );

  const catalog = mergeHttpClientEnvCatalog(dir);
  expect(catalog.$kulalaShared?.$kulalaDefaultHeaders).toEqual({
    Accept: "application/json",
  });
});

test("applyDefaultHeaders: does not override explicit request headers", () => {
  const result = applyDefaultHeaders({
    headers: { Accept: "text/html", Authorization: "Bearer x" },
    url: "https://example.com/path",
    defaultHeaders: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Extra": "yes",
    },
  });
  expect(result.headers.Accept).toBe("text/html");
  expect(result.headers["Content-Type"]).toBe("application/json");
  expect(result.headers["X-Extra"]).toBe("yes");
  expect(result.url).toBe("https://example.com/path");
});

test("applyDefaultHeaders: Host prefixes relative URL", () => {
  const result = applyDefaultHeaders({
    headers: {},
    url: "/api",
    defaultHeaders: { Host: "https://api.example.com" },
  });
  expect(result.headers.Host).toBe("api.example.com");
  expect(result.url).toBe("https://api.example.com/api");
});
