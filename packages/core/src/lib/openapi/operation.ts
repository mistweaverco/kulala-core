import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";
import { isOpenAPIPanelOperatorName } from "./context";
import {
  defaultRequestBodyValue,
  mergeParameterOverrides,
  type OpenAPIOperationOverrides,
} from "./defaults";
import { exampleFromSchema } from "./schema-index";
import { resolveOpenAPIBaseUrl } from "./base-url";
import type { OpenAPIIndex, OpenAPIOperation } from "./types";

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value);
}

function splitMultiValue(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

function paramValue(
  param: { name: string; example?: unknown; schema?: Record<string, unknown> },
  overrides?: Record<string, string>,
): string {
  const override = overrides?.[param.name];
  if (override !== undefined) return override;
  if (param.example !== undefined && param.example !== null) {
    if (Array.isArray(param.example)) {
      return param.example.map((v) => String(v)).join(",");
    }
    return String(param.example);
  }
  if (param.schema?.type === "array") {
    return "";
  }
  const fromSchema = exampleFromSchema(param.schema);
  if (fromSchema !== undefined) return String(fromSchema);
  return param.name;
}

function appendQueryValues(
  query: string[],
  name: string,
  value: string,
  isArray: boolean,
): void {
  if (isArray) {
    for (const part of splitMultiValue(value)) {
      query.push(`${encodeQueryComponent(name)}=${encodeQueryComponent(part)}`);
    }
    return;
  }
  query.push(`${encodeQueryComponent(name)}=${encodeQueryComponent(value)}`);
}

function buildExampleBody(
  requestBody: OpenAPIOperation["requestBody"],
  bodyOverride?: string,
): string | undefined {
  if (bodyOverride !== undefined && bodyOverride.trim() !== "") {
    return bodyOverride;
  }
  return defaultRequestBodyValue(requestBody);
}

export type BuiltOpenAPIOperationRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

function mergeParentAndOperationHeaders(
  parentHeaderSection: KulalaBlock["request"]["headerSection"],
  operationHeaders: Record<string, string>,
): KulalaBlock["request"]["headerSection"] {
  const byKey = new Map<
    string,
    { type: "header"; name: string; value: string }
  >();
  for (const entry of parentHeaderSection ?? []) {
    if (entry.type !== "header") continue;
    const name = entry.name;
    const value = entry.value ?? "";
    byKey.set(name.toLowerCase(), { type: "header", name, value });
  }
  for (const [name, value] of Object.entries(operationHeaders)) {
    if (!value.trim()) continue;
    byKey.set(name.toLowerCase(), { type: "header", name, value });
  }
  return [...byKey.values()];
}

export function buildOperationRequest(
  index: OpenAPIIndex,
  operationKey: string,
  vars: Record<string, string>,
  overrides?: OpenAPIOperationOverrides,
): BuiltOpenAPIOperationRequest | { error: string } {
  const op = index.operations.get(operationKey);
  if (!op) {
    return { error: `Unknown OpenAPI operation: ${operationKey}` };
  }

  const base = resolveOpenAPIBaseUrl(index, vars);
  if (!base) {
    return {
      error:
        "No server URL in spec and no baseUrl variable; set servers in OpenAPI or {{baseUrl}} in env",
    };
  }

  const mergedParams = mergeParameterOverrides(
    op.parameters,
    overrides?.parameters,
  );

  let path = op.path;
  const query: string[] = [];
  const headers: Record<string, string> = {};

  for (const p of mergedParams) {
    const value = paramValue(p, overrides?.parameters);
    const isArray = p.schema?.type === "array";
    if (p.in === "path") {
      path = path.replace(`{${p.name}}`, encodeURIComponent(value));
    } else if (p.in === "query") {
      if (value.trim() === "") continue;
      appendQueryValues(query, p.name, value, isArray);
    } else if (p.in === "header") {
      if (value.trim() === "") continue;
      headers[p.name] = value;
    }
  }

  let url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  if (query.length > 0) {
    url += `?${query.join("&")}`;
  }

  const body = buildExampleBody(op.requestBody, overrides?.body);
  if (body !== undefined) {
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  if (overrides?.headers) {
    for (const [name, value] of Object.entries(overrides.headers)) {
      if (value !== undefined && value !== "") {
        headers[name] = value;
      }
    }
  }

  return {
    method: op.method,
    url,
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

export function buildSyntheticOperationBlock(
  parent: KulalaBlock,
  operationKey: string,
  built: BuiltOpenAPIOperationRequest,
): KulalaBlock {
  const safeName = operationKey.replace(/[^\w]+/g, "_");
  return {
    ...parent,
    name: `${parent.name}::${safeName}`,
    preamble: [],
    comments: [],
    operators: parent.operators.filter(
      (o) => !isOpenAPIPanelOperatorName(o.name),
    ),
    request: {
      method: built.method as KulalaBlock["request"]["method"],
      url: built.url as KulalaHttpURL,
      headerSection: mergeParentAndOperationHeaders(
        parent.request?.headerSection ?? [],
        built.headers,
      ),
      body: built.body,
    },
    scripts: { ...parent.scripts },
    preambleVariables: parent.preambleVariables
      ? { ...parent.preambleVariables }
      : undefined,
    hasRequest: true,
  };
}

export function overridesFromTryItOutValues(
  values: Record<string, string> | undefined,
): OpenAPIOperationOverrides | undefined {
  if (!values) return undefined;
  const parameters: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let body: string | undefined;
  for (const [k, v] of Object.entries(values)) {
    if (k === "__body__") body = v;
    else if (k === "__accept__") headers.Accept = v;
    else parameters[k] = v;
  }
  if (
    Object.keys(parameters).length === 0 &&
    Object.keys(headers).length === 0 &&
    body === undefined
  ) {
    return undefined;
  }
  return {
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

export { defaultParameterValue, defaultRequestBodyValue } from "./defaults";
