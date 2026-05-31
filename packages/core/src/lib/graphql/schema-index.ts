export type GraphQLTypeRef = {
  kind: string;
  name?: string | null;
  ofType?: GraphQLTypeRef | null;
};

export type GraphQLField = {
  name: string;
  description?: string | null;
  args?: GraphQLInputValue[];
  type: GraphQLTypeRef;
};

export type GraphQLInputValue = {
  name: string;
  description?: string | null;
  type: GraphQLTypeRef;
  defaultValue?: string | null;
};

export type GraphQLTypeDef = {
  kind: string;
  name?: string | null;
  description?: string | null;
  fields?: GraphQLField[] | null;
  inputFields?: GraphQLInputValue[] | null;
  enumValues?: Array<{ name: string; description?: string | null }> | null;
};

export type GraphQLSchemaIndex = {
  queryTypeName: string;
  mutationTypeName?: string;
  subscriptionTypeName?: string;
  types: Map<string, GraphQLTypeDef>;
};

type IntrospectionResponse = {
  data?: {
    __schema?: {
      queryType?: { name?: string | null } | null;
      mutationType?: { name?: string | null } | null;
      subscriptionType?: { name?: string | null } | null;
      types?: GraphQLTypeDef[] | null;
    };
  };
  errors?: unknown[];
};

export function parseIntrospectionSchema(
  payload: Record<string, unknown>,
): GraphQLSchemaIndex | undefined {
  const resp = payload as IntrospectionResponse;
  const schema = resp.data?.__schema;
  const queryTypeName = schema?.queryType?.name;
  if (!queryTypeName) return undefined;

  const types = new Map<string, GraphQLTypeDef>();
  for (const t of schema?.types ?? []) {
    if (t?.name) types.set(t.name, t);
  }

  return {
    queryTypeName,
    mutationTypeName: schema?.mutationType?.name ?? undefined,
    subscriptionTypeName: schema?.subscriptionType?.name ?? undefined,
    types,
  };
}

export function namedTypeFromRef(
  ref: GraphQLTypeRef | null | undefined,
): string | undefined {
  if (!ref) return undefined;
  if (ref.kind === "NON_NULL" || ref.kind === "LIST") {
    return namedTypeFromRef(ref.ofType ?? undefined);
  }
  return ref.name ?? undefined;
}

export function getTypeDef(
  index: GraphQLSchemaIndex,
  name: string | undefined,
): GraphQLTypeDef | undefined {
  if (!name) return undefined;
  return index.types.get(name);
}

export function outputFieldsForType(
  index: GraphQLSchemaIndex,
  typeName: string | undefined,
): GraphQLField[] {
  const def = getTypeDef(index, typeName);
  if (!def?.fields) return [];
  return def.fields.filter((f) => !f.name.startsWith("__"));
}

export function fieldReturnTypeName(
  index: GraphQLSchemaIndex,
  parentType: string,
  fieldName: string,
): string | undefined {
  const parent = getTypeDef(index, parentType);
  const field = parent?.fields?.find((f) => f.name === fieldName);
  if (!field) return undefined;
  return namedTypeFromRef(field.type);
}

export type GraphQLOperationKind = "query" | "mutation" | "subscription";

export function rootTypeNameForOperation(
  index: GraphQLSchemaIndex,
  op: GraphQLOperationKind,
): string {
  if (op === "mutation" && index.mutationTypeName) {
    return index.mutationTypeName;
  }
  if (op === "subscription" && index.subscriptionTypeName) {
    return index.subscriptionTypeName;
  }
  return index.queryTypeName;
}
