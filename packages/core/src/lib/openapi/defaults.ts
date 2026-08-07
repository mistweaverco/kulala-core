import { exampleFromSchema } from "./schema-index";
import type { OpenAPIOperation, OpenAPIParameter } from "./types";

export function defaultParameterValue(param: OpenAPIParameter): string {
  if (param.example !== undefined && param.example !== null) {
    if (Array.isArray(param.example)) {
      return param.example.map((v) => String(v)).join(",");
    }
    return String(param.example);
  }
  // Array params (esp. optional multi-select enums) start empty - like Swagger UI.
  if (param.schema?.type === "array") {
    return "";
  }
  const enumVals = param.schema?.enum;
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    return String(enumVals[0]);
  }
  const fromSchema = exampleFromSchema(param.schema);
  if (fromSchema !== undefined) return String(fromSchema);
  return param.name;
}

export function defaultRequestBodyValue(
  requestBody: OpenAPIOperation["requestBody"],
): string | undefined {
  if (!requestBody?.content) return undefined;
  const json =
    requestBody.content["application/json"] ??
    requestBody.content["application/*"];
  const rec =
    json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : undefined;
  if (!rec) return undefined;
  if (rec.example !== undefined) {
    return typeof rec.example === "string"
      ? rec.example
      : JSON.stringify(rec.example, null, 2);
  }
  const schema =
    rec.schema && typeof rec.schema === "object" && !Array.isArray(rec.schema)
      ? (rec.schema as Record<string, unknown>)
      : undefined;
  if (schema?.example !== undefined) {
    return typeof schema.example === "string"
      ? schema.example
      : JSON.stringify(schema.example, null, 2);
  }
  if (schema) {
    const example = exampleFromObjectSchema(schema);
    if (example !== undefined) {
      return JSON.stringify(example, null, 2);
    }
  }
  return undefined;
}

function exampleFromObjectSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const props = schema.properties;
  if (!props || typeof props !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(props as Record<string, unknown>)) {
    const rec =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined;
    if (!rec) continue;
    if (rec.example !== undefined) {
      out[name] = rec.example;
    } else if (rec.type === "string") {
      out[name] = name;
    } else if (rec.type === "integer" || rec.type === "number") {
      out[name] = 0;
    } else if (rec.type === "boolean") {
      out[name] = false;
    } else if (rec.type === "array") {
      out[name] = [];
    } else if (rec.type === "object") {
      out[name] = exampleFromObjectSchema(rec) ?? {};
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export type OpenAPIOperationOverrides = {
  parameters?: Record<string, string>;
  body?: string;
  headers?: Record<string, string>;
};

export function mergeParameterOverrides(
  params: OpenAPIParameter[],
  overrides: Record<string, string> | undefined,
): OpenAPIParameter[] {
  if (!overrides) return params;
  return params.map((p) => {
    const v = overrides[p.name];
    if (v === undefined) return p;
    return { ...p, example: v };
  });
}
