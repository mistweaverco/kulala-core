import type {
  OpenAPIIndex,
  OpenAPIUITreeNode,
  OpenAPIOperation,
} from "./types";
import { defaultParameterValue, defaultRequestBodyValue } from "./defaults";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Enum values from a scalar schema or an array schema's `items.enum`. */
export function parameterOptions(
  schema: Record<string, unknown> | undefined,
): string[] | undefined {
  if (!schema) return undefined;
  const enumVals = schema.enum;
  if (Array.isArray(enumVals) && enumVals.length > 0) {
    return enumVals.map((v) => String(v));
  }
  const items = asRecord(schema.items);
  if (items) {
    const itemEnum = items.enum;
    if (Array.isArray(itemEnum) && itemEnum.length > 0) {
      return itemEnum.map((v) => String(v));
    }
  }
  return undefined;
}

export function isArrayParameterSchema(
  schema: Record<string, unknown> | undefined,
): boolean {
  return schema?.type === "array";
}

function parameterDescription(
  param: OpenAPIOperation["parameters"][number],
  options: string[] | undefined,
): string | undefined {
  const available =
    options && options.length > 0
      ? `Available values : ${options.join(", ")}`
      : undefined;
  if (param.description && available) {
    return `${param.description}\n${available}`;
  }
  return param.description ?? available;
}

function acceptMediaTypeNode(
  key: string,
  mediaTypes: string[],
  idPrefix = "try",
): OpenAPIUITreeNode {
  return {
    id: `${idPrefix}:${key}:accept`,
    kind: "tryItOut",
    title: "Accept (media type)",
    description: "Controls Accept header",
    operationKey: key,
    paramName: "__accept__",
    defaultValue: defaultAcceptMediaType(mediaTypes),
    editable: true,
    options: mediaTypes,
    inputType: "select",
  };
}

function collectOperationMediaTypes(op: OpenAPIOperation): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  if (!op.responses) return ordered;
  for (const code of Object.keys(op.responses).sort()) {
    const rec = asRecord(op.responses[code]);
    const content = asRecord(rec?.content);
    if (!content) continue;
    for (const mediaType of Object.keys(content)) {
      if (seen.has(mediaType)) continue;
      seen.add(mediaType);
      ordered.push(mediaType);
    }
  }
  return ordered;
}

function defaultAcceptMediaType(mediaTypes: string[]): string {
  const json = mediaTypes.find((m) => m.includes("json"));
  return json ?? mediaTypes[0] ?? "";
}

function exampleFromMediaContent(
  entry: Record<string, unknown> | undefined,
): string | undefined {
  if (!entry) return undefined;
  if (entry.example !== undefined) {
    return typeof entry.example === "string"
      ? entry.example
      : JSON.stringify(entry.example, null, 2);
  }
  const schema = asRecord(entry.schema);
  if (schema?.example !== undefined) {
    return typeof schema.example === "string"
      ? schema.example
      : JSON.stringify(schema.example, null, 2);
  }
  return undefined;
}

function truncateExample(text: string, max = 240): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function schemaPropertyNodes(
  schema: Record<string, unknown>,
  prefix: string,
): OpenAPIUITreeNode[] {
  const props = schema.properties;
  if (!props || typeof props !== "object") return [];
  const nodes: OpenAPIUITreeNode[] = [];
  for (const [name, raw] of Object.entries(props as Record<string, unknown>)) {
    const rec = asRecord(raw);
    const type = typeof rec?.type === "string" ? rec.type : undefined;
    const id = `${prefix}:prop:${name}`;
    const childProps =
      rec && type === "object" ? schemaPropertyNodes(rec, id) : [];
    nodes.push({
      id,
      kind: childProps.length > 0 ? "schema" : "text",
      title: name,
      badge: type,
      description:
        typeof rec?.description === "string" ? rec.description : undefined,
      children: childProps.length > 0 ? childProps : undefined,
    });
  }
  return nodes;
}

function tryItOutNodes(op: OpenAPIOperation): OpenAPIUITreeNode[] {
  const key = `${op.method} ${op.path}`;
  const nodes: OpenAPIUITreeNode[] = [];

  for (const p of op.parameters) {
    const options = parameterOptions(p.schema);
    const isArray = isArrayParameterSchema(p.schema);
    const badges: string[] = [];
    if (p.required) badges.push("required");
    if (isArray) {
      const items = asRecord(p.schema?.items);
      const itemType = typeof items?.type === "string" ? items.type : undefined;
      badges.push(itemType ? `array[${itemType}]` : "array");
    }
    nodes.push({
      id: `try:${key}:${p.name}`,
      kind: "tryItOut",
      title: `${p.name} (${p.in})`,
      badge: badges.length > 0 ? badges.join(", ") : undefined,
      description: parameterDescription(p, options),
      operationKey: key,
      paramName: p.name,
      paramIn: p.in,
      defaultValue: defaultParameterValue(p),
      editable: true,
      ...(options
        ? {
            options,
            inputType: (isArray ? "multiSelect" : "select") as
              | "multiSelect"
              | "select",
          }
        : {}),
    });
  }

  const body = defaultRequestBodyValue(op.requestBody);
  if (body !== undefined) {
    nodes.push({
      id: `try:${key}:body`,
      kind: "tryItOut",
      title: "Request body",
      description: op.requestBody?.description,
      operationKey: key,
      paramName: "__body__",
      defaultValue: body,
      editable: true,
    });
  }

  const mediaTypes = collectOperationMediaTypes(op);
  if (mediaTypes.length > 0) {
    nodes.push(acceptMediaTypeNode(key, mediaTypes));
  }

  return nodes;
}

function parameterNodes(op: OpenAPIOperation): OpenAPIUITreeNode[] {
  if (op.parameters.length === 0) return [];
  return op.parameters.map((p) => {
    const options = parameterOptions(p.schema);
    const isArray = isArrayParameterSchema(p.schema);
    const badges: string[] = [];
    if (p.required) badges.push("required");
    if (isArray) {
      const items = asRecord(p.schema?.items);
      const itemType = typeof items?.type === "string" ? items.type : undefined;
      badges.push(itemType ? `array[${itemType}]` : "array");
    }
    return {
      id: `param:${op.method}:${op.path}:${p.name}`,
      kind: "parameter" as const,
      title: `${p.name} (${p.in})`,
      badge: badges.length > 0 ? badges.join(", ") : undefined,
      description: parameterDescription(p, options),
      ...(options
        ? {
            options,
            inputType: (isArray ? "multiSelect" : "select") as
              | "multiSelect"
              | "select",
          }
        : {}),
    };
  });
}

function responseNodes(op: OpenAPIOperation): OpenAPIUITreeNode[] {
  if (!op.responses) return [];
  const key = `${op.method} ${op.path}`;
  return Object.entries(op.responses).map(([code, raw]) => {
    const rec = asRecord(raw);
    const content = asRecord(rec?.content);
    const mediaTypes = content ? Object.keys(content) : [];
    const children: OpenAPIUITreeNode[] = [];

    if (mediaTypes.length > 0) {
      children.push(acceptMediaTypeNode(key, mediaTypes, `response:${code}`));
    }

    for (const mediaType of mediaTypes) {
      const entry = asRecord(content?.[mediaType]);
      const example = exampleFromMediaContent(entry);
      children.push({
        id: `response:${key}:${code}:${mediaType}`,
        kind: "text",
        title: mediaType,
        description: example ? truncateExample(example) : undefined,
      });
    }

    return {
      id: `response:${key}:${code}`,
      kind: "response" as const,
      title: code,
      description:
        typeof rec?.description === "string" ? rec.description : undefined,
      badge: mediaTypes.length > 0 ? `${mediaTypes.length} types` : undefined,
      children: children.length > 0 ? children : undefined,
    };
  });
}

function operationNode(op: OpenAPIOperation): OpenAPIUITreeNode {
  const key = `${op.method} ${op.path}`;
  const children: OpenAPIUITreeNode[] = [];

  const tryItOut = tryItOutNodes(op);
  if (tryItOut.length > 0) {
    children.push({
      id: `section:${key}:tryItOut`,
      kind: "section",
      title: "Try it out",
      badge: String(tryItOut.length),
      operationKey: key,
      children: tryItOut,
    });
  }

  const params = parameterNodes(op);
  if (params.length > 0) {
    children.push({
      id: `section:${key}:parameters`,
      kind: "section",
      title: "Parameters",
      badge: String(params.length),
      children: params,
    });
  }
  if (op.requestBody) {
    children.push({
      id: `section:${key}:requestBody`,
      kind: "section",
      title: "Request Body",
      description: op.requestBody.description,
    });
  }
  const responses = responseNodes(op);
  if (responses.length > 0) {
    children.push({
      id: `section:${key}:responses`,
      kind: "section",
      title: "Responses",
      badge: String(responses.length),
      children: responses,
    });
  }
  return {
    id: `op:${key}`,
    kind: "operation",
    title: `${op.method} ${op.path}`,
    badge: op.summary ?? op.operationId,
    description: op.description,
    operationKey: key,
    children: children.length > 0 ? children : undefined,
  };
}

export function buildOpenAPIUITree(index: OpenAPIIndex): OpenAPIUITreeNode[] {
  const rootTitle = index.title ?? "OpenAPI";
  const versionBadge = index.version ? `v${index.version}` : index.openapi;

  const tagMap = new Map<string, OpenAPIOperation[]>();
  const untagged: OpenAPIOperation[] = [];

  for (const op of index.operations.values()) {
    const tags = op.tags;
    if (!tags || tags.length === 0) {
      untagged.push(op);
      continue;
    }
    for (const tag of tags) {
      const list = tagMap.get(tag) ?? [];
      list.push(op);
      tagMap.set(tag, list);
    }
  }

  const operationSections: OpenAPIUITreeNode[] = [];

  for (const [tag, ops] of [...tagMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    operationSections.push({
      id: `tag:${tag}`,
      kind: "section",
      title: tag,
      badge: String(ops.length),
      children: ops
        .sort((a, b) =>
          `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
        )
        .map(operationNode),
    });
  }

  if (untagged.length > 0) {
    operationSections.push({
      id: "tag:default",
      kind: "section",
      title: "Operations",
      badge: String(untagged.length),
      children: untagged
        .sort((a, b) =>
          `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
        )
        .map(operationNode),
    });
  }

  const schemaNodes: OpenAPIUITreeNode[] = [];
  for (const [name, schema] of [...index.schemas.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const props = schemaPropertyNodes(schema, `schema:${name}`);
    schemaNodes.push({
      id: `schema:${name}`,
      kind: "schema",
      title: name,
      description:
        typeof schema.description === "string" ? schema.description : undefined,
      children: props.length > 0 ? props : undefined,
    });
  }

  const rootChildren: OpenAPIUITreeNode[] = [...operationSections];
  if (schemaNodes.length > 0) {
    rootChildren.push({
      id: "section:schemas",
      kind: "section",
      title: "Schemas",
      badge: String(schemaNodes.length),
      children: schemaNodes,
    });
  }

  return [
    {
      id: "root",
      kind: "section",
      title: rootTitle,
      badge: versionBadge,
      children: rootChildren,
    },
  ];
}

export { collectOperationMediaTypes, defaultAcceptMediaType };
