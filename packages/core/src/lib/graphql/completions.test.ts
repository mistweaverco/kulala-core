import { expect, test } from "bun:test";
import {
  analyzeGraphQLBeforeCursor,
  graphQLCompletionItems,
} from "./completions";
import { parseIntrospectionSchema } from "./schema-index";

const miniIntrospection = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "person",
              type: {
                kind: "OBJECT",
                name: "Person",
                ofType: null,
              },
              args: [{ name: "id", type: { kind: "SCALAR", name: "ID" } }],
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "Person",
          fields: [
            { name: "name", type: { kind: "SCALAR", name: "String" } },
            { name: "height", type: { kind: "SCALAR", name: "String" } },
          ],
        },
      ],
    },
  },
};

test("analyzeGraphQLBeforeCursor detects root field prefix", () => {
  const a = analyzeGraphQLBeforeCursor("query {\n  pe");
  expect(a?.mode).toBe("field");
  expect(a?.fieldSegments).toEqual([]);
  expect(a?.prefix).toBe("pe");
});

test("analyzeGraphQLBeforeCursor detects nested field", () => {
  const a = analyzeGraphQLBeforeCursor("query {\n  person {\n    na");
  expect(a?.fieldSegments).toEqual(["person"]);
  expect(a?.prefix).toBe("na");
});

test("analyzeGraphQLBeforeCursor uses empty prefix on new line after a field", () => {
  const a = analyzeGraphQLBeforeCursor("query {\n  person {\n    name\n    ");
  expect(a?.fieldSegments).toEqual(["person"]);
  expect(a?.prefix).toBe("");
});

test("graphQLCompletionItems on new line after name lists sibling fields", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const query = "query {\n  person {\n    name\n    \n  }\n}";
  const items = graphQLCompletionItems(index, query, 4, 5);
  const labels = items.map((i) => i.label);
  expect(labels).toContain("name");
  expect(labels).toContain("height");
  expect(labels.length).toBeGreaterThanOrEqual(2);
});

test("graphQLCompletionItems suggests fields from introspection", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const query = "query {\n  person {\n    ";
  const items = graphQLCompletionItems(index, query, 3, 5);
  const labels = items.map((i) => i.label);
  expect(labels).toContain("name");
  expect(labels).toContain("height");
});
