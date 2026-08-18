import { readFileSync } from "fs";
import { join } from "path";
import { expect, test } from "bun:test";
import { parseOpenAPIRawText } from "./parse";
import { buildOpenAPIIndex } from "./schema-index";
import { buildOpenAPIUITree } from "./ui-tree";
import {
  buildOperationRequest,
  buildSyntheticOperationBlock,
} from "./operation";
import { openAPICacheKeyFromSource } from "./host";
import { serializeHttpBlock } from "../parser/serde";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";

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

test("serializeHttpBlock yanks an OpenAPI operation as a named .http block", () => {
  const doc = parseOpenAPIRawText(fixtureRaw)!;
  const index = buildOpenAPIIndex(doc)!;
  const built = buildOperationRequest(
    index,
    "POST /pets",
    {},
    {
      body: '{"name":"spot"}',
    },
  );
  expect("error" in built).toBe(false);
  if ("error" in built) return;

  const parent: KulalaBlock = {
    name: "petstore",
    errors: [],
    position: { start: 1, end: 10 },
    preamble: [],
    comments: [],
    operators: [{ name: "kulala-openapi-explorer", lineNumber: 1 }],
    request: {
      method: "GET",
      url: "https://petstore.example.com/openapi.json" as KulalaHttpURL,
      headerSection: [
        { type: "header", name: "Authorization", value: "Bearer {{token}}" },
      ],
    },
    scripts: {
      preRequest: [
        {
          type: "preRequest",
          lang: "js",
          source: "inline",
          content: "client.log('nope')",
          lineNumber: 1,
        },
      ],
      postRequest: [],
    },
    hasRequest: true,
  };

  const synthetic = buildSyntheticOperationBlock(parent, "POST /pets", built);
  const yanked: KulalaBlock = {
    ...synthetic,
    scripts: { preRequest: [], postRequest: [] },
  };
  const http = serializeHttpBlock(yanked);

  expect(http).toContain("### petstore::POST_pets");
  expect(http).toContain("POST https://petstore.example.com/v1/pets");
  expect(http).toContain("Authorization: Bearer {{token}}");
  expect(http).toContain("Content-Type: application/json");
  expect(http).toContain('{"name":"spot"}');
  expect(http).not.toContain("kulala-openapi-explorer");
  expect(http).not.toContain("client.log");
});

test("serializeHttpBlock fills path params from try-it-out overrides", () => {
  const doc = parseOpenAPIRawText(fixtureRaw)!;
  const index = buildOpenAPIIndex(doc)!;
  const built = buildOperationRequest(
    index,
    "GET /pets/{petId}",
    {},
    { parameters: { petId: "42" } },
  );
  expect("error" in built).toBe(false);
  if ("error" in built) return;

  const parent: KulalaBlock = {
    name: "petstore",
    errors: [],
    position: { start: 1, end: 8 },
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: "./openapi.json" as KulalaHttpURL,
      headerSection: [],
    },
    scripts: { preRequest: [], postRequest: [] },
    hasRequest: true,
  };
  const http = serializeHttpBlock(
    buildSyntheticOperationBlock(parent, "GET /pets/{petId}", built),
  );
  expect(http).toContain("### petstore::GET_pets_petId");
  expect(http).toContain("GET https://petstore.example.com/v1/pets/42");
});
