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

  test("pre-request JS awaits complete before globals are cleared (regression)", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "js",
          content: `await new Promise((r) => setTimeout(r, 30));
request.variables.set("NAME", "kulala");`,
          lineNumber: 1,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.NAME).toBe("kulala");
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

  test("post-request TS transpiles type annotations (lang=ts)", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          lang: "ts",
          content: `const foo: string = "bar";
void foo;
request.variables.set("DATE", response.headers.valueOf("Date") || "");`,
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
        body: JSON.stringify({ ok: true }),
        timings: { phases: { total: 1 } },
      },
      vars,
    );

    expect(vars.DATE).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  test("client.assert aborts script execution when condition is false", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          lang: "js",
          content: `
            client.assert(false, "nope");
            request.variables.set("AFTER", "should-not-run");
          `,
          lineNumber: 1,
        },
      ],
      "postRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.AFTER).toBeUndefined();
  });

  test("client.test runs the test function and aborts the script on failure", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          lang: "js",
          content: `
            client.test("fails", () => {
              client.assert(false, "boom");
            });
            request.variables.set("AFTER", "should-not-run");
          `,
          lineNumber: 1,
        },
      ],
      "postRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.AFTER).toBeUndefined();
  });

  test("client.exit stops executing remaining scripts in the same phase", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "js",
          content: `
            request.variables.set("BEFORE", "ok");
            client.exit();
            request.variables.set("AFTER_EXIT", "should-not-run");
          `,
          lineNumber: 1,
        },
        {
          type: "preRequest",
          lang: "js",
          content: `request.variables.set("SECOND_SCRIPT", "should-not-run");`,
          lineNumber: 10,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
    );

    expect(vars.BEFORE).toBe("ok");
    expect(vars.AFTER_EXIT).toBeUndefined();
    expect(vars.SECOND_SCRIPT).toBeUndefined();
  });

  test("client.global supports isEmpty/clear/clearAll and headers.set/clear", async () => {
    const vars: Record<string, string> = {};
    const flow = { globalHeaders: {} as Record<string, string> };
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "js",
          content: `
            client.global.clearAll();
            client.assert(client.global.isEmpty(), "expected empty");
            client.global.set("A", "1");
            client.assert(!client.global.isEmpty(), "expected non-empty");
            client.global.clear("A");
            client.assert(client.global.isEmpty(), "expected empty again");

            client.global.headers.set("X-From-Flow", "yes");
            client.global.headers.clear("X-From-Flow");
          `,
          lineNumber: 1,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
      flow,
    );

    expect(getVariable("global", "A")).toBeUndefined();
    expect(Object.keys(flow.globalHeaders)).toHaveLength(0);
  });

  test("sleep(ms) is available in JS scripts and can be awaited", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          lang: "js",
          content: `
            const start = Date.now();
            await sleep(20);
            const elapsed = Date.now() - start;
            request.variables.set("ELAPSED", String(elapsed));
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
    expect(Number(vars.ELAPSED)).toBeGreaterThanOrEqual(15);
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
