import { readFileSync } from "fs";
import { join } from "path";
import { expect, test } from "bun:test";
import { getDocument } from "../parser/parser";
import { runDocument } from "./index";

const sharedHeadersPath = join(
  import.meta.dir,
  "../../../../../http-example-files/shared-headers.http",
);

test("runDocument: client.global.headers.set in pre-request applies to subsequent blocks", async () => {
  const content = readFileSync(sharedHeadersPath, "utf8");
  const doc = await getDocument(content, sharedHeadersPath);
  const res = await runDocument(doc);

  expect(res.type).toBe("responses");
  expect(res.data).toHaveLength(3);

  for (const item of res.data) {
    expect(item).toHaveProperty("success", true);
    if (!item.success || !("body" in item) || item.body.type !== "json") {
      continue;
    }
    const headers = item.body.content.headers as Record<string, string>;
    expect(headers["x-kulala"] ?? headers["X-Kulala"]).toBe("Family");
  }
});
