import { expect, test } from "bun:test";
import { graphQLHoverMarkdown } from "./hover";
import { parseIntrospectionSchema } from "./schema-index";

const miniIntrospection = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          description: "The root query type.",
          fields: [
            {
              name: "person",
              description: "A person in the Star Wars universe.",
              type: { kind: "OBJECT", name: "Person" },
              args: [
                {
                  name: "personID",
                  description: "ID of the person.",
                  type: {
                    kind: "NON_NULL",
                    ofType: { kind: "SCALAR", name: "ID" },
                  },
                },
              ],
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "Person",
          description: "A humanoid in the Star Wars universe.",
          fields: [
            {
              name: "name",
              description: "The name of the person.",
              type: { kind: "SCALAR", name: "String" },
            },
            {
              name: "height",
              type: { kind: "SCALAR", name: "String" },
            },
          ],
        },
      ],
    },
  },
};

const query = `query Person($id: ID) {
  person(personID: $id) {
    name
  }
}`;

test("graphQLHoverMarkdown describes field on selection set", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const md = graphQLHoverMarkdown(index, query, 3, 6);
  expect(md).toContain("**name**");
  expect(md).toContain("Person");
  expect(md).toContain("The name of the person");
});

test("graphQLHoverMarkdown describes parent field", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const md = graphQLHoverMarkdown(index, query, 2, 4);
  expect(md).toContain("**person**");
  expect(md).toContain("Query");
  expect(md).toContain("personID");
});

test("graphQLHoverMarkdown describes variable", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const md = graphQLHoverMarkdown(index, query, 1, 16);
  expect(md).toContain("**$id**");
  expect(md).toContain("ID");
});

test("graphQLHoverMarkdown describes query root", () => {
  const index = parseIntrospectionSchema(miniIntrospection)!;
  const md = graphQLHoverMarkdown(index, query, 1, 2);
  expect(md).toContain("**query**");
  expect(md).toContain("Query");
  expect(md).toContain("Entry fields");
});
