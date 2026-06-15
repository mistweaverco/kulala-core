import { expect, test } from "bun:test";
import { parseGraphQLContent } from "./graphql-content";

test("parseGraphQLContent preserves raw variables text when JSON is invalid", () => {
  const content = [
    "query Person($id: ID) {",
    "  person(personID: $id) { name }",
    "}",
    "",
    "{",
    '  "id": {{ PERSON_ID }}',
    "}",
  ].join("\n");

  expect(parseGraphQLContent(content)).toEqual({
    query: "query Person($id: ID) {\n  person(personID: $id) { name }\n}",
    variablesSourceText: '{\n  "id": {{ PERSON_ID }}\n}',
  });
});

test("parseGraphQLContent parses valid variables JSON normally", () => {
  const content = [
    "query Person($id: ID) { person(personID: $id) { name } }",
    "",
    '{ "id": 1 }',
  ].join("\n");

  expect(parseGraphQLContent(content)).toEqual({
    query: "query Person($id: ID) { person(personID: $id) { name } }",
    variables: { id: 1 },
  });
});
