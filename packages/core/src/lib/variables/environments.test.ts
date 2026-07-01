import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  loadEnvironmentCatalog,
  mergeHttpClientEnvCatalog,
} from "./environments";
import {
  findWithsecretsYamlDir,
  isWithsecretsInPath,
  resolveWithsecretsCli,
} from "./withsecrets";

const tmpRoot = join(import.meta.dir, ".tmp-environments-test");

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

test("mergeHttpClientEnvCatalog: merges env sections closest-wins", () => {
  const root = join(tmpRoot, "nested");
  const child = join(root, "api");
  mkdirSync(child, { recursive: true });

  writeFileSync(
    join(root, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: { API_URL: "https://root.example" },
      default: { TOKEN: "root-token" },
      dev: { TOKEN: "root-dev" },
    }),
  );
  writeFileSync(
    join(child, "http-client.env.json"),
    JSON.stringify({
      default: { TOKEN: "child-token" },
      staging: { HOST: "staging.example" },
    }),
  );

  const catalog = mergeHttpClientEnvCatalog(child);
  expect(catalog.$kulalaShared?.API_URL).toBe("https://root.example");
  expect(catalog.environments.default?.TOKEN).toBe("child-token");
  expect(catalog.environments.dev?.TOKEN).toBe("root-dev");
  expect(catalog.environments.staging?.HOST).toBe("staging.example");
});

test("findWithsecretsYamlDir: prefers ws.yaml and still finds kuba.yaml", () => {
  const dir = join(tmpRoot, "legacy-config");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "kuba.yaml"), "default:\n  provider: local\n");
  expect(findWithsecretsYamlDir(dir)).toBe(dir);

  const wsDir = join(tmpRoot, "ws-config");
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, "ws.yaml"), "default:\n  provider: local\n");
  writeFileSync(join(wsDir, "kuba.yaml"), "default:\n  provider: local\n");
  expect(findWithsecretsYamlDir(wsDir)).toBe(wsDir);
});

test("loadEnvironmentCatalog: includes withsecrets environments when ws/kuba is available", async () => {
  const dir = join(tmpRoot, "withsecrets-project");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "ws.yaml"),
    `default:
  provider: local
  env:
    WITHSECRETS_ONLY:
      value: "from-withsecrets"
`,
  );

  const catalog = await loadEnvironmentCatalog(dir);
  if (isWithsecretsInPath()) {
    expect(catalog.environments.default?.WITHSECRETS_ONLY).toBe(
      "from-withsecrets",
    );
    expect(resolveWithsecretsCli()).toBeTruthy();
  } else {
    expect(catalog.environments.default).toBeDefined();
  }
});

test("loadEnvironmentCatalog: default env when no files", async () => {
  const dir = join(tmpRoot, "empty");
  mkdirSync(dir, { recursive: true });
  const catalog = await loadEnvironmentCatalog(dir);
  expect(catalog.environments.default).toBeDefined();
});
