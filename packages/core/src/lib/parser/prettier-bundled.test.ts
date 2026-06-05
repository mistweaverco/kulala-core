import { describe, expect, test } from "bun:test";
import { formatWithBundledPrettier } from "./prettier-bundled";

describe("formatWithBundledPrettier", () => {
  test("formats JSON without external prettier resolution", async () => {
    const formatted = await formatWithBundledPrettier(
      `{"a":1,"b":[2,3]}`,
      "json",
    );
    expect(formatted).toContain('"a": 1');
    expect(formatted).toContain('"b": [2, 3]');
  });

  test("formats GraphQL without external prettier resolution", async () => {
    const formatted = await formatWithBundledPrettier(
      `{ user { id name } }`,
      "graphql",
    );
    expect(formatted).toContain("user {");
    expect(formatted).toContain("id");
  });
});
