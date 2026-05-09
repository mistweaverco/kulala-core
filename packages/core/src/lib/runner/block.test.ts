import { expect, test } from "bun:test";
import { findBlockAtCursor } from "./block";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import { getDocument } from "../parser/parser";

function makeBlock(name: string, start: number, end: number): KulalaBlock {
  return {
    name,
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: "/",
      headerSection: [],
    },
    scripts: { preRequest: [], postRequest: [] },
    position: { start, end },
  };
}

test("findBlockAtCursor returns block that contains line", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [
      makeBlock("A", 1, 10),
      makeBlock("B", 11, 20),
      makeBlock("C", 21, 30),
    ],
  };
  expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe("A");
  expect(findBlockAtCursor(doc, { line: 10, column: 1 })?.name).toBe("A");
  expect(findBlockAtCursor(doc, { line: 11, column: 1 })?.name).toBe("B");
  expect(findBlockAtCursor(doc, { line: 20, column: 1 })?.name).toBe("B");
  expect(findBlockAtCursor(doc, { line: 25, column: 5 })?.name).toBe("C");
});

test("findBlockAtCursor returns null when no block contains line", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [makeBlock("A", 1, 10)],
  };
  expect(findBlockAtCursor(doc, { line: 0, column: 1 })).toBeNull();
  expect(findBlockAtCursor(doc, { line: 11, column: 1 })).toBeNull();
});

test("findBlockAtCursor returns first matching block when ranges overlap", () => {
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [makeBlock("A", 1, 15), makeBlock("B", 10, 20)],
  };
  expect(findBlockAtCursor(doc, { line: 12, column: 1 })?.name).toBe("A");
});

test("findBlockAtCursor adjusts cursor position when directives are removed", () => {
  // Simulate: 3 directive lines removed, then blocks start at line 1 in contentWithoutDirectives
  // Original file: directives (lines 1-3) + block A (lines 4-13)
  // After removal: block A (lines 1-10)
  // Cursor at line 8 in original = line 5 in contentWithoutDirectives
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [makeBlock("A", 1, 10)],
    directiveLinesRemoved: 3,
    nativeBlockCount: 1,
  };
  // Cursor at line 8 in original file should find block A (which is at line 1-10 in stripped content)
  expect(findBlockAtCursor(doc, { line: 8, column: 1 })?.name).toBe("A");
  // Cursor at line 2 in original (before directives end) should not find anything
  expect(findBlockAtCursor(doc, { line: 2, column: 1 })).toBeNull();
});

test("findBlockAtCursor only searches native blocks, not imported/run blocks", () => {
  // Native block A at position 1-10
  // Imported block B at position 1-5 (from another file)
  // Cursor at line 3 should match native block A, not imported block B
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [
      makeBlock("A", 1, 10), // Native block
      makeBlock("B", 1, 5), // Imported block (would be at different position in its source file)
    ],
    nativeBlockCount: 1, // Only first block is native
  };
  expect(findBlockAtCursor(doc, { line: 3, column: 1 })?.name).toBe("A");
  // Cursor at line 2 should also match native block A, not imported block B
  expect(findBlockAtCursor(doc, { line: 2, column: 1 })?.name).toBe("A");
});

test("findBlockAtCursor handles directives and imported blocks together", () => {
  // Original file: 2 directive lines + native block A (lines 3-12)
  // After removal: native block A (lines 1-10)
  // Plus imported block B (from another file)
  const doc: KulalaDocument = {
    filepath: "/test.http",
    hasErrors: false,
    directives: [],
    blocks: [
      makeBlock("A", 1, 10), // Native block (after directive removal)
      makeBlock("B", 1, 5), // Imported block
    ],
    directiveLinesRemoved: 2,
    nativeBlockCount: 1,
  };
  // Cursor at line 5 in original = line 3 in contentWithoutDirectives, should match native block A
  expect(findBlockAtCursor(doc, { line: 5, column: 1 })?.name).toBe("A");
  // Cursor at line 1 in original (in directive area) should not find anything
  expect(findBlockAtCursor(doc, { line: 1, column: 1 })).toBeNull();
});

test("findBlockAtCursor integration test with real parser - no directives", async () => {
  const content = `### GQL_STARWARS_QUERY_PERSON

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Person($id: ID) {
  person(personID: $id) {
    name
  }
}

{
  "id": 1
}

### GQL_STARWARS_QUERY_PLANET

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Planet($id: ID) {
  planet(planetID: $id) {
    name
  }
}

{
  "id": 1
}`;

  const doc = await getDocument(content, "/test.http");

  // Cursor at line 8 (inside first block) should find first block
  const block1 = findBlockAtCursor(doc, { line: 8, column: 1 });
  expect(block1?.name).toBe("GQL_STARWARS_QUERY_PERSON");

  // Cursor at line 22 (inside second block) should find second block
  const block2 = findBlockAtCursor(doc, { line: 22, column: 1 });
  expect(block2?.name).toBe("GQL_STARWARS_QUERY_PLANET");
});

test("findBlockAtCursor integration test with real parser - with directives", async () => {
  const content = `import ./other.http
run #SOME_BLOCK

### GQL_STARWARS_QUERY_PERSON

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Person($id: ID) {
  person(personID: $id) {
    name
  }
}

{
  "id": 1
}

### GQL_STARWARS_QUERY_PLANET

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Planet($id: ID) {
  planet(planetID: $id) {
    name
  }
}

{
  "id": 1
}`;

  const doc = await getDocument(content, "/test.http");

  // Cursor at line 10 in original (line 8 after removing 2 directive lines) should find first block
  const block1 = findBlockAtCursor(doc, { line: 10, column: 1 });
  expect(block1?.name).toBe("GQL_STARWARS_QUERY_PERSON");

  // Cursor at line 24 in original (line 22 after removing 2 directive lines) should find second block
  const block2 = findBlockAtCursor(doc, { line: 24, column: 1 });
  expect(block2?.name).toBe("GQL_STARWARS_QUERY_PLANET");

  // Cursor at line 2 (in directive area) should not find anything
  const block3 = findBlockAtCursor(doc, { line: 2, column: 1 });
  expect(block3).toBeNull();
});

test("findBlockAtCursor regression test", async () => {
  const content = `### GQL_STARWARS_QUERY_PERSON

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Person($id: ID) {
  person(personID: $id) {
    name
  }
}

{
  "id": 1
}

### GQL_STARWARS_QUERY_PLANET

GRAPHQL https://swapi-graphql.netlify.app/.netlify/functions/index HTTP/1.1
Accept: application/json

query Planet($id: ID) {
  planet(planetID: $id) {
    name
  }
}

{
  "id": 1
}`;

  const doc = await getDocument(content, "http-example-files/graphql.http");

  // Cursor at line 8 (inside first block) should find first block, not second
  const block = findBlockAtCursor(doc, { line: 8, column: 1 });
  expect(block?.name).toBe("GQL_STARWARS_QUERY_PERSON");
  expect(block?.name).not.toBe("GQL_STARWARS_QUERY_PLANET");

  // Cursor at line 22 (inside second block) should find second block
  const block2 = findBlockAtCursor(doc, { line: 22, column: 1 });
  expect(block2?.name).toBe("GQL_STARWARS_QUERY_PLANET");
});

test("findBlockAtCursor cursor on last line of block (no trailing newline)", async () => {
  const content = "### test\nGET http://example.com";
  const doc = await getDocument(content, "/test.http");
  const lastLine = content.split("\n").length;
  expect(findBlockAtCursor(doc, { line: lastLine, column: 1 })?.name).toBe(
    "test",
  );
});

test("findBlockAtCursor on ### line of second block does not match first block", async () => {
  const content =
    "### HTTP_1_0\nGET http://example.com HTTP/1.0\n### HTTP_1_1_REQUEST\nGET http://example.com HTTP/1.1\n";
  const doc = await getDocument(content, "/test.http");
  expect(findBlockAtCursor(doc, { line: 1, column: 1 })?.name).toBe("HTTP_1_0");
  expect(findBlockAtCursor(doc, { line: 2, column: 1 })?.name).toBe("HTTP_1_0");
  expect(findBlockAtCursor(doc, { line: 3, column: 1 })?.name).toBe(
    "HTTP_1_1_REQUEST",
  );
  expect(findBlockAtCursor(doc, { line: 4, column: 1 })?.name).toBe(
    "HTTP_1_1_REQUEST",
  );
});
