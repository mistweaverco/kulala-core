import { describe, expect, test } from "bun:test";
import { getScript } from "./script";
import { getDocument } from "./parser";

describe("getScript", () => {
  test("parses inline pre-request Lua with JetBrains-style %}", async () => {
    const line = "< {% lang=lua";
    const blockLines = [
      "< {% lang=lua",
      '  request.variables.set("NAME", "kulala")',
      "%}",
    ];
    const r = await getScript(line, blockLines, 0, "/tmp/foo.http");
    if ("errorMessage" in r) {
      throw new Error(r.errorMessage);
    }
    expect(r.type).toBe("preRequest");
    expect(r.lang).toBe("lua");
    expect(r.content.trim()).toBe('request.variables.set("NAME", "kulala")');
  });

  test("parses inline post-request TS with lang=ts", async () => {
    const blockLines = [
      "> {% lang=ts",
      '  const foo: string = "bar";',
      '  request.variables.set("DATE", response.headers.valueOf("Date") || "")',
      "%}",
    ];
    const r = await getScript(blockLines[0]!, blockLines, 0, "/tmp/foo.http");
    if ("errorMessage" in r) {
      throw new Error(r.errorMessage);
    }
    expect(r.type).toBe("postRequest");
    expect(r.lang).toBe("ts");
    expect(r.content).toContain("const foo: string");
    expect(r.content).toContain("request.variables.set");
  });

  test("parses inline post-request Lua with legacy %\\} closing", async () => {
    const line = "> {% lang=lua";
    const blockLines = [
      "> {% lang=lua",
      '  request.variables.set("X", "1")',
      "%\\}",
    ];
    const r = await getScript(line, blockLines, 0, "/tmp/foo.http");
    if ("errorMessage" in r) {
      throw new Error(r.errorMessage);
    }
    expect(r.type).toBe("postRequest");
    expect(r.lang).toBe("lua");
    expect(r.content.trim()).toBe('request.variables.set("X", "1")');
  });
});

describe("getDocument + Lua scripts", () => {
  test("parses block with inline Lua pre and post scripts", async () => {
    const content = `### LUA
< {% lang=lua
  request.variables.set("NAME", "kulala")
%}
GET https://example.com

> {% lang=lua
  request.variables.set("STATUS", tostring(response.status))
%}
`;
    const doc = await getDocument(content);
    const block = doc.blocks[0];
    expect(block.errors).toEqual([]);
    expect(block.scripts.preRequest).toHaveLength(1);
    expect(block.scripts.postRequest).toHaveLength(1);
    const pre = block.scripts.preRequest[0];
    const post = block.scripts.postRequest[0];
    expect(pre?.lang).toBe("lua");
    expect(post?.lang).toBe("lua");
    expect(pre?.content).toContain("NAME");
    expect(post?.content).toContain("response.status");
  });
});

describe("getDocument + TypeScript scripts", () => {
  test("parses block with inline post-request lang=ts", async () => {
    const content = `### TS_POST
GET https://example.com

> {% lang=ts
  const foo: string = "bar";
  request.variables.set("DATE", response.headers.valueOf("Date") || "");
%}
`;
    const doc = await getDocument(content);
    const block = doc.blocks[0];
    expect(block?.errors).toEqual([]);
    expect(block?.scripts.postRequest).toHaveLength(1);
    expect(block?.scripts.postRequest[0]?.lang).toBe("ts");
    expect(block?.scripts.postRequest[0]?.content).toContain(
      "const foo: string",
    );
  });
});
