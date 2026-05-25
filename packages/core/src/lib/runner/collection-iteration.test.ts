import { describe, expect, test } from "bun:test";
import {
  detectCollectionIterationPlan,
  parseVariableCollection,
  templateValueAtIndex,
  varsForCollectionIndex,
} from "./collection-iteration";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";

const block: KulalaBlock = {
  name: "REQ",
  errors: [],
  preamble: [],
  comments: [],
  operators: [],
  request: {
    method: "GET",
    url: "https://example.com/items/{{id}}" as KulalaHttpURL,
    headerSection: [],
    body: '{"name": {{name}}}',
  },
  scripts: { preRequest: [], postRequest: [] },
  position: { start: 1, end: 1 },
};

describe("collection-iteration", () => {
  test("parseVariableCollection accepts JSON arrays", () => {
    expect(parseVariableCollection("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseVariableCollection("plain")).toBeNull();
  });

  test("detectCollectionIterationPlan counts array variables used in request", () => {
    const plan = detectCollectionIterationPlan(block, block.request.body, {
      id: "[1,2,3]",
      name: '["a","b","c"]',
    });
    expect(plan.count).toBe(3);
    expect(plan.primaryCollection).toBe("id");
    expect(plan.collections.id).toEqual([1, 2, 3]);
  });

  test("varsForCollectionIndex substitutes element at index", () => {
    const plan = detectCollectionIterationPlan(block, block.request.body, {
      id: "[10,20]",
    });
    expect(varsForCollectionIndex({}, plan.collections, 1).id).toBe("20");
  });

  test("templateValueAtIndex returns collection element", () => {
    const plan = detectCollectionIterationPlan(block, block.request.body, {
      id: '["x","y"]',
    });
    expect(templateValueAtIndex(plan, 1)).toBe("y");
  });

  test("detectCollectionIterationPlan supports JSONPath {{ users[*].name }}", () => {
    const usersBlock: KulalaBlock = {
      ...block,
      request: {
        ...block.request,
        url: "https://example.com/users/{{users[*].name}}" as KulalaHttpURL,
      },
    };
    const usersJson = JSON.stringify([
      { name: "Alice", id: 1 },
      { name: "Bob", id: 2 },
    ]);
    const plan = detectCollectionIterationPlan(usersBlock, null, {
      users: usersJson,
    });
    expect(plan.count).toBe(2);
    expect(plan.collections["users[*].name"]).toEqual(["Alice", "Bob"]);
    expect(
      varsForCollectionIndex({}, plan.collections, 1)["users[*].name"],
    ).toBe("Bob");
  });
});
