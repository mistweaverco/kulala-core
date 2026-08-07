import type {
  OpenAPIIndex,
  OpenAPIOperation,
  OpenAPIParameter,
  OpenAPIDocument,
} from "./types";
import { isOpenAPIDocument } from "./parse";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function paramFromRaw(
  raw: Record<string, unknown>,
): OpenAPIParameter | undefined {
  const name = typeof raw.name === "string" ? raw.name : undefined;
  const inLoc = typeof raw.in === "string" ? raw.in : undefined;
  if (!name || !inLoc) return undefined;
  const schema = asRecord(raw.schema);
  return {
    name,
    in: inLoc,
    required: raw.required === true,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    schema,
    example: raw.example ?? schema?.example,
  };
}

function exampleFromSchema(
  schema: Record<string, unknown> | undefined,
): unknown {
  if (!schema) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  const type = schema.type;
  if (type === "string") return "string";
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return false;
  return undefined;
}

function requestBodyFromRaw(
  raw: Record<string, unknown> | undefined,
): OpenAPIOperation["requestBody"] | undefined {
  if (!raw) return undefined;
  const content = asRecord(raw.content);
  return {
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    required: raw.required === true,
    content: content ?? undefined,
  };
}

export function buildOpenAPIIndex(
  doc: OpenAPIDocument,
  specSource?: string,
): OpenAPIIndex | undefined {
  if (!isOpenAPIDocument(doc)) return undefined;

  const info = asRecord(doc.info);
  const title = typeof info?.title === "string" ? info.title : undefined;
  const version = typeof info?.version === "string" ? info.version : undefined;
  const openapi =
    typeof doc.openapi === "string"
      ? doc.openapi
      : doc.swagger === "2.0"
        ? "2.0"
        : "3.0.0";

  const servers: string[] = [];
  if (Array.isArray(doc.servers)) {
    for (const s of doc.servers) {
      const rec = asRecord(s);
      if (rec && typeof rec.url === "string") servers.push(rec.url);
    }
  }
  if (doc.swagger === "2.0") {
    const host = typeof doc.host === "string" ? doc.host : "";
    const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : ["https"];
    if (host) {
      for (const scheme of schemes) {
        if (typeof scheme === "string") {
          servers.push(`${scheme}://${host}${basePath}`);
        }
      }
    }
  }

  const operations = new Map<string, OpenAPIOperation>();
  const paths = asRecord(doc.paths);
  if (paths) {
    for (const [path, pathItem] of Object.entries(paths)) {
      const item = asRecord(pathItem);
      if (!item) continue;
      const pathLevelParams: OpenAPIParameter[] = [];
      if (Array.isArray(item.parameters)) {
        for (const p of item.parameters) {
          const rec = asRecord(p);
          if (rec) {
            const param = paramFromRaw(rec);
            if (param) pathLevelParams.push(param);
          }
        }
      }
      for (const [method, opRaw] of Object.entries(item)) {
        const m = method.toLowerCase();
        if (
          ![
            "get",
            "post",
            "put",
            "delete",
            "patch",
            "head",
            "options",
          ].includes(m)
        ) {
          continue;
        }
        const op = asRecord(opRaw);
        if (!op) continue;
        const opParams: OpenAPIParameter[] = [...pathLevelParams];
        if (Array.isArray(op.parameters)) {
          for (const p of op.parameters) {
            const rec = asRecord(p);
            if (rec) {
              const param = paramFromRaw(rec);
              if (param) opParams.push(param);
            }
          }
        }
        const tags = Array.isArray(op.tags)
          ? op.tags.filter((t): t is string => typeof t === "string")
          : undefined;
        const operation: OpenAPIOperation = {
          method: m.toUpperCase(),
          path,
          operationId:
            typeof op.operationId === "string" ? op.operationId : undefined,
          summary: typeof op.summary === "string" ? op.summary : undefined,
          description:
            typeof op.description === "string" ? op.description : undefined,
          tags,
          parameters: opParams,
          requestBody: requestBodyFromRaw(asRecord(op.requestBody)),
          responses: asRecord(op.responses) ?? undefined,
        };
        operations.set(`${operation.method} ${path}`, operation);
      }
    }
  }

  const schemas = new Map<string, Record<string, unknown>>();
  const components = asRecord(doc.components);
  const compSchemas = asRecord(components?.schemas);
  if (compSchemas) {
    for (const [name, schema] of Object.entries(compSchemas)) {
      const rec = asRecord(schema);
      if (rec) schemas.set(name, rec);
    }
  }
  if (doc.swagger === "2.0") {
    const defs = asRecord(doc.definitions);
    if (defs) {
      for (const [name, schema] of Object.entries(defs)) {
        const rec = asRecord(schema);
        if (rec) schemas.set(name, rec);
      }
    }
  }

  return {
    openapi,
    title,
    version,
    servers,
    operations,
    schemas,
    specSource,
  };
}

export { exampleFromSchema };
