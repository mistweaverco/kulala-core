export type KulalaGraphQLBodyContent = {
  query: string;
  variables?: Record<string, unknown>;
  /** Raw variables JSON when it could not be parsed (e.g. unquoted {{ var }} placeholders). */
  variablesSourceText?: string;
};

/** Parse variables JSON from trailing .http body text (after a `< path` line or blank line). */
export function parseGraphQLVariablesJson(
  content: string,
): Record<string, unknown> | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const jsonStr = trimmed
      .replace(/\\\{/g, "{")
      .replace(/\\\}/g, "}")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(jsonStr) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore invalid variables JSON
  }
  return undefined;
}

/** Parse GraphQL request body text: query, optional variables JSON after a blank line. */
export function parseGraphQLContent(content: string): KulalaGraphQLBodyContent {
  const parts = content
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Note: stdin JSON encoding may escape braces as \{ and \}. Undo that for GraphQL queries.
  const query = (parts[0] ?? "").replace(/\\\{/g, "{").replace(/\\\}/g, "}");
  let variables: Record<string, unknown> | undefined = undefined;

  if (parts.length > 1) {
    const variablesPart = parts[1]!;
    variables = parseGraphQLVariablesJson(variablesPart);
    if (variables === undefined) {
      return {
        query,
        variablesSourceText: variablesPart,
      };
    }
  }

  return {
    query,
    ...(variables !== undefined ? { variables } : {}),
  };
}
