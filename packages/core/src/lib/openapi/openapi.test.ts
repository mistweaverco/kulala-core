import { readFileSync } from "fs";
import { join } from "path";
import { expect, test } from "bun:test";
import { parseOpenAPIRawText } from "./parse";
import { buildOpenAPIIndex } from "./schema-index";
import { buildOpenAPIUITree } from "./ui-tree";
import { buildOperationRequest } from "./operation";
import { openAPICacheKeyFromSource } from "./host";

const fixturePath = join(import.meta.dir, "fixtures", "petstore-minimal.json");
const fixtureRaw = readFileSync(fixturePath, "utf-8");

test("parseOpenAPIRawText parses JSON fixture", () => {
  const doc = parseOpenAPIRawText(fixtureRaw);
  expect(doc).toBeDefined();
  expect(doc?.openapi).toBe("3.0.0");
});

test("buildOpenAPIIndex extracts operations and schemas", () => {
  const doc = parseOpenAPIRawText(fixtureRaw)!;
  const index = buildOpenAPIIndex(doc)!;
  expect(index.operations.size).toBe(3);
  expect(index.operations.get("GET /pets")?.summary).toBe("List pets");
  expect(index.schemas.has("Pet")).toBe(true);
});

test("buildOpenAPIUITree groups by tags", () => {
  const doc = parseOpenAPIRawText(fixtureRaw)!;
  const index = buildOpenAPIIndex(doc)!;
  const tree = buildOpenAPIUITree(index);
  expect(tree.length).toBe(1);
  expect(tree[0]?.title).toBe("Petstore");
  const children = tree[0]?.children ?? [];
  const petsTag = children.find((c) => c.title === "pets");
  expect(petsTag?.badge).toBe("3");
});

test("buildOperationRequest builds URL with base server", () => {
  const doc = parseOpenAPIRawText(fixtureRaw)!;
  const index = buildOpenAPIIndex(doc)!;
  const built = buildOperationRequest(index, "GET /pets/{petId}", {});
  expect("error" in built).toBe(false);
  if ("error" in built) return;
  expect(built.method).toBe("GET");
  expect(built.url).toContain("/pets/1");
});

test("openAPICacheKeyFromSource uses host for remote URLs", () => {
  expect(
    openAPICacheKeyFromSource("https://echo.kulala.app/openapi.json", "/tmp"),
  ).toBe("echo.kulala.app");
});

test("parseOpenAPIRawText parses minimal YAML", () => {
  const yaml = `openapi: "3.0.0"
info:
  title: YAML API
  version: "1.0"
paths: {}
`;
  const doc = parseOpenAPIRawText(yaml);
  expect(doc?.info).toBeDefined();
  const info = doc?.info as Record<string, unknown>;
  expect(info.title).toBe("YAML API");
});
