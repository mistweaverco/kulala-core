import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { getDocument } from "../parser/parser";
import { httpExamplesDir } from "../../test/http-examples";
import { graphQLBlockCursorContext } from "./context";

const graphqlHttp = readFileSync(join(httpExamplesDir, "graphql.http"), "utf8");

test("graphQLBlockCursorContext extracts query body after headers (blank after ###)", async () => {
  const doc = await getDocument(graphqlHttp, "graphql.http");
  const ctx = await graphQLBlockCursorContext(doc, {
    content: graphqlHttp,
    filepath: "graphql.http",
    line: 8,
    column: 5,
  });
  expect(ctx).not.toBeNull();
  expect(ctx!.query).toContain("query Person");
  expect(ctx!.query).toContain("person(personID");
  expect(ctx!.query).not.toContain("GRAPHQL https://");
  expect(ctx!.queryLine).toBe(3);
});

test("graphQLBlockCursorContext returns null in variables JSON section", async () => {
  const doc = await getDocument(graphqlHttp, "graphql.http");
  const ctx = await graphQLBlockCursorContext(doc, {
    content: graphqlHttp,
    filepath: "graphql.http",
    line: 13,
    column: 5,
  });
  expect(ctx).toBeNull();
});

test("graphQLBlockCursorContext allows new line below a selected field", async () => {
  const content = `### GQL_TEST

GRAPHQL https://swapi-graphql.netlify.app/graphql HTTP/1.1
Accept: application/json

query Person($id: ID) {
  person(personID: $id) {
    name

  }
}

{
  "id": 1
}
`;
  const doc = await getDocument(content, "test.http");
  const ctx = await graphQLBlockCursorContext(doc, {
    content,
    filepath: "test.http",
    line: 9,
    column: 5,
  });
  expect(ctx).not.toBeNull();
  expect(ctx!.queryLine).toBe(4);
  expect(ctx!.query).toContain("name");
});
