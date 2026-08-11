import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";
import { getDbInMemory, setDbForTesting } from "../persistence";
import { bundleOpenAPIRefs, resolveJsonPointer } from "./resolve-refs";
import { normalizeSwagger2Document } from "./normalize-swagger2";
import { prepareOpenAPIDocument } from "./prepare-document";
import { buildOpenAPIIndex } from "./schema-index";
import { buildOpenAPIUITree } from "./ui-tree";
import {
  buildOperationRequest,
  buildSyntheticOperationBlock,
} from "./operation";
import { openAPILoadAtCursor, runOpenAPIOperation } from "./index";

test("resolveJsonPointer resolves components schema", () => {
  const doc = {
    components: {
      schemas: {
        Pet: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  };
  const resolved = resolveJsonPointer(doc, "#/components/schemas/Pet");
  expect(resolved).toEqual({
    type: "object",
    properties: { name: { type: "string" } },
  });
});

test("bundleOpenAPIRefs inlines $ref in request body schema", () => {
  const doc = {
    openapi: "3.0.0",
    paths: {
      "/pets": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
          responses: { "201": { description: "ok" } },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          properties: { name: { type: "string", example: "fluffy" } },
        },
      },
    },
  };
  const bundled = bundleOpenAPIRefs(doc);
  const index = buildOpenAPIIndex(bundled)!;
  const op = index.operations.get("POST /pets")!;
  const content = op.requestBody?.content?.["application/json"] as Record<
    string,
    unknown
  >;
  const schema = content?.schema as Record<string, unknown>;
  expect(schema?.properties).toBeDefined();
});

test("normalizeSwagger2Document converts body parameter to requestBody", () => {
  const swagger2 = {
    swagger: "2.0",
    host: "api.example.com",
    basePath: "/v1",
    schemes: ["https"],
    paths: {
      "/items": {
        post: {
          parameters: [
            {
              in: "body",
              name: "body",
              required: true,
              schema: {
                type: "object",
                properties: { title: { type: "string" } },
              },
            },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  const normalized = normalizeSwagger2Document(swagger2);
  const index = buildOpenAPIIndex(normalized)!;
  expect(index.servers[0]).toBe("https://api.example.com/v1");
  const op = index.operations.get("POST /items")!;
  expect(op.requestBody?.content?.["application/json"]).toBeDefined();
});

test("buildOpenAPIUITree includes Try it out section", () => {
  const doc = prepareOpenAPIDocument(
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://ex.test" }],
      paths: {
        "/x": {
          get: {
            parameters: [
              {
                name: "q",
                in: "query",
                schema: { type: "string", example: "hi" },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }),
  )!;
  const index = buildOpenAPIIndex(doc)!;
  const tree = buildOpenAPIUITree(index);
  const root = tree[0]!;
  const tag = (root.children ?? [])[0]!;
  const op = (tag.children ?? [])[0]!;
  const trySection = (op.children ?? []).find((c) => c.title === "Try it out");
  expect(trySection).toBeDefined();
  expect(trySection?.children?.[0]?.kind).toBe("tryItOut");
  expect(trySection?.children?.[0]?.defaultValue).toBe("hi");
});

test("buildOperationRequest applies parameter overrides", () => {
  const doc = prepareOpenAPIDocument(
    JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "https://ex.test" }],
      paths: {
        "/x/{id}": {
          get: {
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string", example: "1" },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }),
  )!;
  const index = buildOpenAPIIndex(doc)!;
  const built = buildOperationRequest(
    index,
    "GET /x/{id}",
    {},
    {
      parameters: { id: "42" },
    },
  );
  expect("error" in built).toBe(false);
  if ("error" in built) return;
  expect(built.url).toContain("/x/42");
});

test("buildOperationRequest applies Accept header from try it out", () => {
  const doc = prepareOpenAPIDocument(
    JSON.stringify({
      openapi: "3.0.0",
      servers: [{ url: "https://ex.test" }],
      paths: {
        "/img/{format}": {
          get: {
            parameters: [
              {
                name: "format",
                in: "path",
                required: true,
                schema: { type: "string", enum: ["svg", "png"] },
              },
            ],
            responses: {
              "200": {
                description: "Image content",
                content: {
                  "image/svg+xml": { schema: { type: "string" } },
                  "image/png": { schema: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
      },
    }),
  )!;
  const index = buildOpenAPIIndex(doc)!;
  const built = buildOperationRequest(
    index,
    "GET /img/{format}",
    {},
    {
      parameters: { format: "png" },
      headers: { Accept: "image/png" },
    },
  );
  expect("error" in built).toBe(false);
  if ("error" in built) return;
  expect(built.url).toContain("/img/png");
  expect(built.headers.Accept).toBe("image/png");
});

test("buildOpenAPIUITree includes Accept media type and descriptions", () => {
  const doc = prepareOpenAPIDocument(
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://ex.test" }],
      paths: {
        "/img/{format}": {
          get: {
            summary: "Serve image",
            description: "Returns logo bytes",
            parameters: [
              {
                name: "format",
                in: "path",
                required: true,
                schema: { type: "string", enum: ["svg", "png"] },
              },
            ],
            responses: {
              "200": {
                description: "Image content",
                content: {
                  "image/svg+xml": { schema: { type: "string" } },
                  "image/png": { schema: { type: "string" } },
                },
              },
            },
          },
        },
      },
    }),
  )!;
  const index = buildOpenAPIIndex(doc)!;
  const tree = buildOpenAPIUITree(index);
  const op = tree[0]!.children![0]!.children![0]!;
  expect(op.description).toBe("Returns logo bytes");
  const trySection = (op.children ?? []).find((c) => c.title === "Try it out");
  const accept = trySection?.children?.find(
    (c) => c.paramName === "__accept__",
  );
  expect(accept?.options).toEqual(["image/svg+xml", "image/png"]);
  expect(accept?.defaultValue).toBe("image/svg+xml");
  const format = trySection?.children?.find((c) => c.paramName === "format");
  expect(format?.options).toEqual(["svg", "png"]);
  expect(format?.defaultValue).toBe("svg");
  const responses = (op.children ?? []).find((c) => c.title === "Responses");
  const r200 = responses?.children?.[0];
  expect(r200?.description).toBe("Image content");
  expect(r200?.children?.[0]?.paramName).toBe("__accept__");
  expect(r200?.children?.[0]?.options).toEqual(["image/svg+xml", "image/png"]);
  expect(r200?.children?.slice(1).map((c) => c.title)).toEqual([
    "image/svg+xml",
    "image/png",
  ]);
});

test("array enum query params get multiSelect options from items.enum", () => {
  const doc = prepareOpenAPIDocument(
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Port", version: "1" },
      servers: [{ url: "https://api.port.io" }],
      paths: {
        "/v1/apps": {
          get: {
            summary: "Get all credentials",
            parameters: [
              {
                name: "fields",
                in: "query",
                required: false,
                description: "The fields to include in the response.",
                schema: {
                  type: "array",
                  items: {
                    type: "string",
                    enum: [
                      "id",
                      "name",
                      "createdAt",
                      "updatedAt",
                      "secret",
                      "enabled",
                    ],
                  },
                },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }),
  )!;
  const index = buildOpenAPIIndex(doc)!;
  const tree = buildOpenAPIUITree(index);
  const op = tree[0]!.children![0]!.children![0]!;
  const trySection = (op.children ?? []).find((c) => c.title === "Try it out");
  const fields = trySection?.children?.find((c) => c.paramName === "fields");
  expect(fields?.inputType).toBe("multiSelect");
  expect(fields?.badge).toBe("array[string]");
  expect(fields?.options).toEqual([
    "id",
    "name",
    "createdAt",
    "updatedAt",
    "secret",
    "enabled",
  ]);
  expect(fields?.defaultValue).toBe("");
  expect(fields?.description).toContain("Available values");

  const built = buildOperationRequest(
    index,
    "GET /v1/apps",
    {},
    {
      parameters: { fields: "id,name" },
    },
  );
  expect("error" in built).toBe(false);
  if ("error" in built) return;
  expect(built.url).toContain("fields=id");
  expect(built.url).toContain("fields=name");
  expect(built.url).not.toMatch(/fields=id%2Cname|fields=id,name/);
});

test("buildSyntheticOperationBlock merges parent headers and operation overrides", () => {
  const parent: KulalaBlock = {
    name: "openapi",
    errors: [],
    position: { start: 1, end: 10 },
    preamble: [],
    comments: [],
    operators: [{ name: "kulala-openapi-explorer", lineNumber: 1 }],
    request: {
      method: "GET",
      url: "https://ex.test/openapi.json" as KulalaHttpURL,
      headerSection: [
        {
          type: "header",
          name: "Authorization",
          value: "Bearer parent",
        },
        { type: "header", name: "X-Custom", value: "from-http" },
      ],
    },
    scripts: { preRequest: [], postRequest: [] },
    hasRequest: true,
  };
  const synthetic = buildSyntheticOperationBlock(parent, "GET /x", {
    method: "GET",
    url: "https://ex.test/x",
    headers: {
      Authorization: "Bearer operation",
      Accept: "application/json",
    },
  });
  const headers = Object.fromEntries(
    (synthetic.request.headerSection ?? [])
      .filter(
        (
          h,
        ): h is Extract<
          (typeof synthetic.request.headerSection)[number],
          { type: "header" }
        > => h.type === "header",
      )
      .map((h) => [h.name, h.value]),
  );
  expect(headers.Authorization).toBe("Bearer operation");
  expect(headers["X-Custom"]).toBe("from-http");
  expect(headers.Accept).toBe("application/json");
});

test("runOpenAPIOperation runs pre-request scripts against the operation URL", async () => {
  setDbForTesting(getDbInMemory());
  const dir = mkdtempSync(join(tmpdir(), "kulala-openapi-op-abort-"));
  const specPath = join(dir, "spec.json");
  writeFileSync(
    specPath,
    JSON.stringify({
      openapi: "3.0.0",
      info: { title: "T", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/items": {
          get: { responses: { "200": { description: "ok" } } },
        },
      },
    }),
  );
  const scriptPath = join(dir, "pre.js");
  writeFileSync(
    scriptPath,
    `if (request.url.tryGetSubstituted().endsWith("/swagger.json")) {
  client.exit(0);
}
$kulala.request.abort("operation auth required");`,
  );
  const content = `### openapi-abort
< ${scriptPath}

# @kulala-openapi-explorer

GET ${specPath} HTTP/1.1
`;
  const filepath = join(dir, "test.http");
  writeFileSync(filepath, content);

  await openAPILoadAtCursor({
    content,
    filepath,
    line: 5,
    column: 1,
  });

  const result = await runOpenAPIOperation({
    content,
    filepath,
    line: 5,
    column: 1,
    operationKey: "GET /items",
  });

  expect(result).toMatchObject({
    success: false,
    aborted: true,
    error: "operation auth required",
  });
  expect(result).not.toHaveProperty("status");
});
