import { afterEach, beforeEach, expect, test } from "bun:test";
import { closeDb, getDbInMemory, setDbForTesting } from "../persistence";
import { clearGraphQLSchemaCache, graphqlSchemaHostFromUrl } from "./index";
import {
  loadGraphQLSchema,
  saveGraphQLSchema,
} from "../persistence/graphql-schema-store";

beforeEach(() => {
  setDbForTesting(getDbInMemory());
});

afterEach(() => {
  closeDb();
});

test("graphqlSchemaHostFromUrl normalizes host and port", () => {
  expect(graphqlSchemaHostFromUrl("https://api.example.com/graphql")).toBe(
    "api.example.com",
  );
  expect(graphqlSchemaHostFromUrl("http://localhost:4000/gql")).toBe(
    "localhost:4000",
  );
});

test("save and load GraphQL schema by host", () => {
  const schema = { data: { __schema: { queryType: { name: "Query" } } } };
  saveGraphQLSchema("api.example.com", schema);
  const loaded = loadGraphQLSchema("api.example.com");
  expect(loaded?.schema).toEqual(schema);
});

test("clearGraphQLSchemaCache removes one or all hosts", () => {
  saveGraphQLSchema("a.test", { data: {} });
  saveGraphQLSchema("b.test", { data: {} });
  const one = clearGraphQLSchemaCache("a.test");
  expect(one.cleared).toBe(1);
  expect(loadGraphQLSchema("a.test")).toBeUndefined();
  expect(loadGraphQLSchema("b.test")).toBeDefined();
  const all = clearGraphQLSchemaCache();
  expect(all.cleared).toBe(1);
});
