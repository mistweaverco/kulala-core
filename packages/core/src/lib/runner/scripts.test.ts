import { describe, expect, test, beforeEach } from "bun:test";
import { runScripts } from "./scripts";
import { getDbInMemory, setDbForTesting, getVariable } from "../persistence";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";

const dummyBlock: KulalaBlock = {
  name: "REQ",
  errors: [],
  preamble: [],
  comments: [],
  operators: [],
  request: {
    method: "GET",
    url: "https://example.com" as KulalaHttpURL,
    headerSection: [],
  },
  scripts: { preRequest: [], postRequest: [] },
  position: { start: 1, end: 1 },
};

describe("scripts", () => {
  beforeEach(() => {
    setDbForTesting(getDbInMemory());
  });

  test("pre-request JS can inject request variables", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "js",
          content: `request.variables.set("FOO", "bar");`,
          lineNumber: 1,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.FOO).toBe("bar");
  });

  test("post-request JS can read response and set vars", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          lang: "js",
          content: `
            request.variables.set("STATUS", String(response.status));
            request.variables.set("DATE", response.headers.valueOf("Date") ?? "");
            request.variables.set("TOKEN", response.body.json.token);
          `,
          lineNumber: 1,
        },
      ],
      "postRequest",
      dummyBlock,
      "/tmp/example.http",
      {
        statusCode: 200,
        headers: {
          Date: "Mon, 01 Jan 2024 00:00:00 GMT",
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: "abc" }),
        timings: { phases: { total: 1 } },
      },
      vars,
    );

    expect(vars.STATUS).toBe("200");
    expect(vars.DATE).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(vars.TOKEN).toBe("abc");
  });

  test("pre-request Lua can inject request variables and set global vars", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "lua",
          content: `
            request.variables.set("FOO", "bar")
            client.global.set("GLOB", "baz")
          `,
          lineNumber: 1,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.FOO).toBe("bar");
    expect(getVariable("global", "GLOB")).toBe("baz");
  });

  test("post-request Lua can read response status/headers/body", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          lang: "lua",
          content: `
            request.variables.set("STATUS", tostring(response.status))
            request.variables.set("DATE", response.headers.valueOf("Date") or "")
            request.variables.set("TOKEN", response.body.json.token)
          `,
          lineNumber: 1,
        },
      ],
      "postRequest",
      dummyBlock,
      "/tmp/example.http",
      {
        statusCode: 201,
        headers: {
          Date: "Tue, 02 Jan 2024 00:00:00 GMT",
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: "xyz" }),
        timings: { phases: { total: 1 } },
      },
      vars,
    );

    expect(vars.STATUS).toBe("201");
    expect(vars.DATE).toBe("Tue, 02 Jan 2024 00:00:00 GMT");
    expect(vars.TOKEN).toBe("xyz");
  });
});
