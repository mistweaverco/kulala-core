import type { OpenAPIDocument } from "./types";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Normalize Swagger 2.0 paths into OpenAPI-3-like shape for shared indexing:
 * - `body` parameter → `requestBody`
 * - `formData` parameters → `requestBody` multipart content
 */
export function normalizeSwagger2Document(
  doc: OpenAPIDocument,
): OpenAPIDocument {
  if (doc.swagger !== "2.0") return doc;

  const paths = asRecord(doc.paths);
  if (!paths) return doc;

  const out = cloneJson(doc);

  for (const [path, pathItem] of Object.entries(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    normalizePathItem(item);
    out.paths = out.paths ?? {};
    (out.paths as Record<string, unknown>)[path] = item;
  }

  return out;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePathItem(item: Record<string, unknown>): void {
  normalizeParameters(item);

  for (const method of [
    "get",
    "post",
    "put",
    "delete",
    "patch",
    "head",
    "options",
  ]) {
    const op = asRecord(item[method]);
    if (!op) continue;
    normalizeOperationParameters(op);
    item[method] = op;
  }
}

function normalizeParameters(item: Record<string, unknown>): void {
  if (!Array.isArray(item.parameters)) return;
  const kept: unknown[] = [];
  for (const raw of item.parameters) {
    const p = asRecord(raw);
    if (!p) continue;
    if (p.in === "body" || p.in === "formData") continue;
    kept.push(raw);
  }
  item.parameters = kept;
}

function normalizeOperationParameters(op: Record<string, unknown>): void {
  if (!Array.isArray(op.parameters)) return;

  const kept: unknown[] = [];
  let bodySchema: Record<string, unknown> | undefined;
  let bodyRequired = false;
  let bodyDescription: string | undefined;
  const formFields: Record<string, unknown> = {};

  for (const raw of op.parameters) {
    const p = asRecord(raw);
    if (!p || typeof p.in !== "string") {
      kept.push(raw);
      continue;
    }

    if (p.in === "body") {
      bodySchema = asRecord(p.schema) ?? { type: "object" };
      bodyRequired = p.required === true;
      bodyDescription =
        typeof p.description === "string" ? p.description : undefined;
      continue;
    }

    if (p.in === "formData") {
      const name = typeof p.name === "string" ? p.name : "field";
      formFields[name] = {
        type: p.type ?? "string",
        ...(typeof p.description === "string"
          ? { description: p.description }
          : {}),
        ...(p.format ? { format: p.format } : {}),
      };
      if (p.required === true) {
        formFields[name] = {
          ...(formFields[name] as Record<string, unknown>),
        };
      }
      continue;
    }

    kept.push(raw);
  }

  op.parameters = kept;

  if (bodySchema) {
    op.requestBody = {
      required: bodyRequired,
      ...(bodyDescription ? { description: bodyDescription } : {}),
      content: {
        "application/json": { schema: bodySchema },
      },
    };
  } else if (Object.keys(formFields).length > 0) {
    op.requestBody = {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            properties: formFields,
          },
        },
      },
    };
  }

  // Swagger 2 responses with schema → OpenAPI 3 content
  const responses = asRecord(op.responses);
  if (responses) {
    for (const [code, respRaw] of Object.entries(responses)) {
      const resp = asRecord(respRaw);
      if (!resp || resp.content) continue;
      const schema = asRecord(resp.schema);
      if (schema) {
        resp.content = {
          "application/json": { schema },
        };
        delete resp.schema;
        responses[code] = resp;
      }
    }
    op.responses = responses;
  }
}
