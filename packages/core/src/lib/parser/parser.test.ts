import { expect, test } from "bun:test";
import { getDocument } from "./parser";

test("parser: GraphQL query with type annotations not parsed as header", async () => {
  const content = `### GQL_WITH_VARIABLES

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Person($id: ID) {
  person(personID: $id) {
    name
  }
}

{
  "id": 1
}`;

  const doc = await getDocument(content);
  const block = doc.blocks[0];

  expect(block.errors).toEqual([]);
  expect(block.request.method).toBe("GRAPHQL");
  expect(block.request.httpVersion).toBe("HTTP/1.1");
  expect(
    block.request.headerSection.filter((h) => h.type === "header"),
  ).toHaveLength(1);
  expect(block.request.headerSection[0]?.type).toBe("header");
  if (block.request.headerSection[0]?.type === "header") {
    expect(block.request.headerSection[0].name).toBe("Accept");
    expect(block.request.headerSection[0].value).toBe("application/json");
  }
  expect(block.request.body).toBeDefined();
  if (
    block.request.body &&
    typeof block.request.body === "object" &&
    "query" in block.request.body
  ) {
    expect((block.request.body as { query: string }).query).toContain(
      "query Person($id: ID)",
    );
    expect((block.request.body as { query: string }).query).toContain(
      "person(personID: $id)",
    );
    expect(
      (block.request.body as { variables?: Record<string, unknown> }).variables,
    ).toEqual({
      id: 1,
    });
  }
});

test("parser: GraphQL query with multiple type annotations", async () => {
  const content = `### GQL_COMPLEX

GRAPHQL https://api.example.com/graphql HTTP/1.1
Content-Type: application/json
Authorization: Bearer token123

query GetUsers($filter: UserFilter, $limit: Int, $offset: Int) {
  users(filter: $filter, limit: $limit, offset: $offset) {
    id
    name
    email: String
  }
}

{
  "filter": { "active": true },
  "limit": 10,
  "offset": 0
}`;

  const doc = await getDocument(content);
  const block = doc.blocks[0];

  expect(block.errors).toEqual([]);
  expect(block.request.method).toBe("GRAPHQL");
  const headers = block.request.headerSection.filter(
    (h) => h.type === "header",
  );
  expect(headers).toHaveLength(2);
  expect(headers.map((h) => (h.type === "header" ? h.name : null))).toEqual([
    "Content-Type",
    "Authorization",
  ]);
  expect(block.request.body).toBeDefined();
  if (
    block.request.body &&
    typeof block.request.body === "object" &&
    "query" in block.request.body
  ) {
    const body = block.request.body as {
      query: string;
      variables?: Record<string, unknown>;
    };
    expect(body.query).toContain("query GetUsers($filter: UserFilter");
    expect(body.query).toContain("$limit: Int");
    expect(body.query).toContain("$offset: Int");
    expect(body.variables).toEqual({
      filter: { active: true },
      limit: 10,
      offset: 0,
    });
  }
});

test("parser: regular POST with JSON body containing colons not parsed as headers", async () => {
  const content = `### POST_REQUEST

POST https://api.example.com/users HTTP/1.1
Content-Type: application/json

{
  "user": {
    "name": "John",
    "settings": {
      "theme": "dark",
      "timezone": "UTC"
    }
  }
}`;

  const doc = await getDocument(content);
  const block = doc.blocks[0];

  expect(block.errors).toEqual([]);
  expect(block.request.method).toBe("POST");
  const headers = block.request.headerSection.filter(
    (h) => h.type === "header",
  );
  expect(headers).toHaveLength(1);
  expect(headers[0]?.type).toBe("header");
  if (headers[0]?.type === "header") {
    expect(headers[0].name).toBe("Content-Type");
  }
  expect(block.request.body).toBeDefined();
});

test("parser: POST with body from file (< path) JetBrains syntax", async () => {
  const content = `### POST_BODY_FROM_FILE

POST https://example.com:8080/api/html/post HTTP/1.1
Content-Type: application/json

< ./input.json`;

  const doc = await getDocument(content);
  const block = doc.blocks[0];

  expect(block.errors).toEqual([]);
  expect(block.request.method).toBe("POST");
  expect(block.request.body).toEqual({ __bodyFromFile: "./input.json" });
});

test("parser: redirect response to file (>> and >>!) JetBrains syntax", async () => {
  const contentWithAppend = `### SAVE_RESPONSE

GET https://httpbin.org/get HTTP/1.1

>> myFolder/myFile.json`;

  const docAppend = await getDocument(contentWithAppend);
  const blockAppend = docAppend.blocks[0];
  expect(blockAppend.errors).toEqual([]);
  expect(blockAppend.request.responseRedirect).toEqual({
    filePath: "myFolder/myFile.json",
    overwrite: false,
  });

  const contentWithOverwrite = `### OVERWRITE_RESPONSE

POST https://httpbin.org/post HTTP/1.1
Content-Type: application/json

{}
>>! output/result.json`;

  const docOverwrite = await getDocument(contentWithOverwrite);
  const blockOverwrite = docOverwrite.blocks[0];
  expect(blockOverwrite.errors).toEqual([]);
  expect(blockOverwrite.request.responseRedirect).toEqual({
    filePath: "output/result.json",
    overwrite: true,
  });
});

test("parser: request line sets httpVersion (HTTP/1.1, HTTP/2)", async () => {
  const contentHttp11 = `### GET_HTTP_1_1
GET https://example.com/ HTTP/1.1

### GET_HTTP_2
GET https://example.com/ HTTP/2
`;

  const doc = await getDocument(contentHttp11);
  expect(doc.blocks).toHaveLength(2);
  expect(doc.blocks[0]?.request.method).toBe("GET");
  expect(doc.blocks[0]?.request.httpVersion).toBe("HTTP/1.1");
  expect(doc.blocks[1]?.request.method).toBe("GET");
  expect(doc.blocks[1]?.request.httpVersion).toBe("HTTP/2");
});
