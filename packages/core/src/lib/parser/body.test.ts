import { expect, test } from "bun:test";
import { getBody } from "./body";

/** `getBody` returns parsed JSON for `type: "json"`; the request-body type still models `content` as `string`. */
function parsedJsonContent(content: unknown): unknown {
  return typeof content === "string" ? JSON.parse(content) : content;
}

/** Raw body text as stored in `sourceText` (slice from body start through trim). */
function expectedSourceText(lines: string[], lineIdx: number): string {
  return lines.slice(lineIdx).join("\n").trim();
}

test("getBody: GraphQL without variables", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Query {",
    "  allFilms {",
    "    films {",
    "      title",
    "    }",
    "  }",
    "}",
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Query {\n  allFilms {\n    films {\n      title\n    }\n  }\n}",
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL with variables", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID) {",
    "  person(personID: $id) {",
    "    name",
    "  }",
    "}",
    "",
    '{ "id": 1 }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID) {\n  person(personID: $id) {\n    name\n  }\n}",
      variables: { id: 1 },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL with variables and trailing comma", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID) {",
    "  person(personID: $id) {",
    "    name",
    "  }",
    "}",
    "",
    '{ "id": 1, }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID) {\n  person(personID: $id) {\n    name\n  }\n}",
      variables: { id: 1 },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL with multiple blank lines", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Query {",
    "  allFilms { films { title } }",
    "}",
    "",
    "",
    '{ "id": 1 }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query: "query Query {\n  allFilms { films { title } }\n}",
      variables: { id: 1 },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL query only (no variables)", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query { user { name } }",
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query: "query { user { name } }",
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GRAPHQL with body from file (< path) uses bodyFromFile", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "< ./query.graphql",
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "bodyFromFile",
    content: { __bodyFromFile: "./query.graphql" },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GRAPHQL with body from file and inline variables", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "< ./query.graphql",
    "",
    '{ "id": 1 }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "bodyFromFile",
    content: {
      __bodyFromFile: "./query.graphql",
      __graphqlVariablesSuffix: '{ "id": 1 }',
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: body from file (< path) JetBrains syntax", async () => {
  const lines = [
    "POST https://example.com:8080/api/html/post HTTP/1.1",
    "Content-Type: application/json",
    "",
    "< ./input.json",
  ];
  const result = await getBody(lines, 3, "POST");
  expect(result).toEqual({
    type: "bodyFromFile",
    content: { __bodyFromFile: "./input.json" },
    sourceText: expectedSourceText(lines, 3),
  });
});

test("getBody: body from file with path without leading ./", async () => {
  const lines = [
    "POST https://example.com/api HTTP/1.1",
    "",
    "< path/to/file.json",
  ];
  const result = await getBody(lines, 2, "POST");
  expect(result).toEqual({
    type: "bodyFromFile",
    content: { __bodyFromFile: "path/to/file.json" },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: body from file with quoted path", async () => {
  const lines = [
    "POST https://example.com/api HTTP/1.1",
    "",
    '< "fixtures/input.json"',
  ];
  const result = await getBody(lines, 2, "POST");
  expect(result).toEqual({
    type: "bodyFromFile",
    content: { __bodyFromFile: "fixtures/input.json" },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: JSON body with trailing >> redirect line is stripped (no stray > in payload)", async () => {
  const lines = [
    "POST https://echo.kulala.app/post HTTP/1.1",
    "Content-Type: application/json",
    "",
    "{",
    '  "name": "Kulala-Core"',
    "}",
    "",
    ">> ./redirect-response-to-file.tmp.json",
  ];
  const result = await getBody(lines, 3, "POST");
  if ("errorMessage" in result) {
    throw new Error(result.errorMessage);
  }
  expect(result.type).toBe("json");
  if (result.type === "json") {
    const content = parsedJsonContent(result.content) as Record<
      string,
      unknown
    >;
    expect(content.name).toBe("Kulala-Core");
    const str = JSON.stringify(content);
    expect(str.endsWith(">")).toBe(false);
  }
});

test("getBody: JSON body with trailing >> redirect and trailing newline is stripped", async () => {
  const lines = [
    "POST https://example.com/post HTTP/1.1",
    "Content-Type: application/json",
    "",
    '{ "x": 1 }',
    "",
    ">> ./out.json",
    "",
  ];
  const result = await getBody(lines, 3, "POST");
  if ("errorMessage" in result) {
    throw new Error(result.errorMessage);
  }
  expect(result.type).toBe("json");
  if (result.type === "json") {
    expect(parsedJsonContent(result.content)).toEqual({ x: 1 });
  }
});

test("getBody: non-GraphQL method parses as JSON", async () => {
  const lines = [
    "POST https://api.example.com/api HTTP/1.1",
    "",
    '{ "key": "value" }',
  ];
  const result = await getBody(lines, 2, "POST");
  if ("errorMessage" in result) {
    throw new Error(result.errorMessage);
  }
  expect(result.type).toBe("json");
  if (result.type === "json") {
    expect(parsedJsonContent(result.content)).toEqual({ key: "value" });
  }
});

test("getBody: GraphQL with variables containing variable placeholders", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID) {",
    "  person(personID: $id) {",
    "    name",
    "  }",
    "}",
    "",
    '{ "id": "{{userId}}" }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID) {\n  person(personID: $id) {\n    name\n  }\n}",
      variables: { id: "{{userId}}" },
    },
    sourceText: expectedSourceText(lines, 2),
  });
  // Note: Variable substitution happens later in the runner via substituteInObject
});

test("getBody: GraphQL unescapes \\{ and \\} in query", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID) \\{",
    "  person(personID: $id) \\{",
    "    name",
    "  \\}",
    "\\}",
    "",
    '{ "id": 1 }',
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID) {\n  person(personID: $id) {\n    name\n  }\n}",
      variables: { id: 1 },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL with multi-line indented variables JSON", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID, $name: String) {",
    "  person(personID: $id, name: $name) {",
    "    name",
    "    email",
    "  }",
    "}",
    "",
    "{",
    '  "id": 1,',
    '  "name": "John Doe",',
    '  "address": {',
    '    "street": "123 Main St",',
    '    "city": "New York",',
    '    "zip": "10001"',
    "  }",
    "}",
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID, $name: String) {\n  person(personID: $id, name: $name) {\n    name\n    email\n  }\n}",
      variables: {
        id: 1,
        name: "John Doe",
        address: {
          street: "123 Main St",
          city: "New York",
          zip: "10001",
        },
      },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});

test("getBody: GraphQL with multi-line variables JSON with trailing comma", async () => {
  const lines = [
    "GRAPHQL https://api.example.com/graphql HTTP/1.1",
    "",
    "query Person($id: ID) {",
    "  person(personID: $id) {",
    "    name",
    "  }",
    "}",
    "",
    "{",
    '  "id": 1,',
    '  "filter": "active",',
    "}",
  ];
  const result = await getBody(lines, 2, "GRAPHQL");
  expect(result).toEqual({
    type: "graphql",
    content: {
      query:
        "query Person($id: ID) {\n  person(personID: $id) {\n    name\n  }\n}",
      variables: {
        id: 1,
        filter: "active",
      },
    },
    sourceText: expectedSourceText(lines, 2),
  });
});
