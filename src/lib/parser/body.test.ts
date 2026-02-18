import { expect, test } from "bun:test";
import { getBody } from "./body";

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
  });
});

test("getBody: non-GraphQL method parses as JSON", async () => {
  const lines = [
    "POST https://api.example.com/api HTTP/1.1",
    "",
    '{ "key": "value" }',
  ];
  const result = await getBody(lines, 2, "POST");
  expect(result).toEqual({
    type: "json",
    content: { key: "value" },
  });
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
  });
  // Note: Variable substitution happens later in the runner via substituteInObject
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
  });
});
