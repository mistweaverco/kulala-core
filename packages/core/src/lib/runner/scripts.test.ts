import { beforeEach, describe, expect, test } from "bun:test";
import { runScripts } from "./scripts";
import { getDbInMemory, getVariable, setDbForTesting } from "../persistence";
import { ScriptPromptError } from "./script-prompt-error";
import { ScriptReplayError, ScriptSkipError } from "./script-control-error";
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
    // stub console.* to avoid noisy output during tests that trigger script errors
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      debug: console.debug,
    };
    console.error = () => {};
    console.log = () => {};
    // restore original console.* after each test
    // in Bun's test environment,
    // there's no built-in afterEach,
    // so we return a cleanup function from beforeEach
    return () => {
      console.error = originalConsole.error;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.debug = originalConsole.debug;
    };
  });

  test("pre-request JS can inject request variables", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
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
          source: "inline",
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

  test("client.global.get returns structured values (JetBrains parity)", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
          lang: "js",
          content: `
            client.global.set("CACHE", {
              username: "octo",
              expiresOnUnixTimestamp: 9999999999999,
            });
            const cache = client.global.get("CACHE");
            if (!cache || cache.username !== "octo") {
              throw new Error("expected object from client.global.get");
            }
            request.variables.set("USER", cache.username);
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

    expect(vars.USER).toBe("octo");
    expect(vars["CACHE.username"]).toBe("octo");
    const { substituteInString } = await import("../variables/substitute");
    expect(substituteInString("{{CACHE.username}}", vars)).toBe("octo");
  });

  test("post-request JS can read response and set vars", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          source: "inline",
          lang: "js",
          content: `
            client.global.set("STATUS", String(response.status));
            client.global.set("DATE", response.headers.valueOf("Date") ?? "");
            client.global.set("TOKEN", response.body.token);
            client.global.set("MIME", response.contentType.mimeType);
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

    // request.variables.set is not available in post-request scripts (JetBrains parity),
    // but client.global.set is allowed and should update vars for later substitution.
    expect(vars.STATUS).toBe("200");
    expect(vars.DATE).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(vars.TOKEN).toBe("abc");
    expect(vars.MIME).toBe("application/json");
  });

  test("post-request TS transpiles type annotations (lang=ts)", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          source: "inline",
          lang: "ts",
          content: `const foo: string = "bar";
void foo;
client.global.set("DATE", response.headers.valueOf("Date") || "");`,
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

  test("post-request JS cannot call request.variables.set (JetBrains parity)", async () => {
    const vars: Record<string, string> = {};
    expect(
      runScripts(
        [
          {
            type: "postRequest",
            source: "inline",
            lang: "js",
            content: `request.variables.set("NOPE", "x");`,
            lineNumber: 1,
          },
        ],
        "postRequest",
        dummyBlock,
        "/tmp/example.http",
        {
          statusCode: 200,
          headers: {},
          body: "{}",
          timings: { phases: { total: 1 } },
        },
        vars,
      ),
    ).rejects.toThrow(/post-request scripts/);
    expect(vars.NOPE).toBeUndefined();
  });

  test("client.assert aborts script execution when condition is false", async () => {
    expect(
      runScripts(
        [
          {
            type: "postRequest",
            source: "inline",
            lang: "js",
            content: `client.assert(false, "nope");`,
            lineNumber: 1,
          },
        ],
        "postRequest",
        dummyBlock,
        "/tmp/example.http",
        {
          statusCode: 200,
          headers: {},
          body: "{}",
          timings: { phases: { total: 1 } },
        },
        {},
      ),
    ).rejects.toThrow("nope");
  });

  test("client.assert and client.test emit structured scriptConsole lines", async () => {
    const scriptConsole: import("./types").KulalaScriptConsoleLine[] = [];
    await runScripts(
      [
        {
          type: "postRequest",
          source: "inline",
          lang: "js",
          content: `
            client.assert(true, "standalone assert");
            client.test("nested test", () => {
              client.assert(true, "nested assert");
            });
          `,
          lineNumber: 1,
        },
      ],
      "postRequest",
      dummyBlock,
      "/tmp/example.http",
      {
        statusCode: 200,
        headers: {},
        body: "{}",
        timings: { phases: { total: 1 } },
      },
      {},
      undefined,
      scriptConsole,
    );

    expect(scriptConsole).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assert",
          status: "pass",
          message: "standalone assert",
          testName: undefined,
        }),
        expect.objectContaining({
          kind: "assert",
          status: "pass",
          message: "nested assert",
          testName: "nested test",
        }),
        expect.objectContaining({
          kind: "test",
          status: "pass",
          testName: "nested test",
          message: "nested test",
        }),
      ]),
    );
  });

  test("client.test runs the test function and aborts the script on failure", async () => {
    expect(
      runScripts(
        [
          {
            type: "postRequest",
            source: "inline",
            lang: "js",
            content: `client.test("fails", () => {
              client.assert(false, "boom");
            });`,
            lineNumber: 1,
          },
        ],
        "postRequest",
        dummyBlock,
        "/tmp/example.http",
        {
          statusCode: 200,
          headers: {},
          body: "{}",
          timings: { phases: { total: 1 } },
        },
        {},
      ),
    ).rejects.toThrow("boom");
  });

  test("pre-request script errors propagate and abort the request", async () => {
    expect(
      runScripts(
        [
          {
            type: "preRequest",
            source: "inline",
            lang: "js",
            content: `throw new Error("pre-request failed");`,
            lineNumber: 1,
          },
        ],
        "preRequest",
        dummyBlock,
        "/tmp/example.http",
        undefined,
        {},
      ),
    ).rejects.toThrow("pre-request failed");
  });

  test("client.exit stops executing remaining scripts in the same phase", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
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
          source: "inline",
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
          source: "inline",
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
          source: "inline",
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
          source: "inline",
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

  test("pre-request Lua can set a table variable for JSONPath substitution", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
          lang: "lua",
          content: `
            request.variables.set("users", {
              { name = "Alice" },
              { name = "Bob" },
            })
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

    const { substituteInString } = await import("../variables/substitute");
    expect(substituteInString("{{users[*].name}}", vars)).toBe("Alice");
  });

  test("post-request Lua can read response status/headers/body", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          source: "inline",
          lang: "lua",
          content: `
            client.global.set("STATUS", tostring(response.status))
            client.global.set("DATE", response.headers.valueOf("Date") or "")
            client.global.set("TOKEN", response.body.token)
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

  test("post-request JS can read response.cookies (JetBrains parity)", async () => {
    const vars: Record<string, string> = {};
    await runScripts(
      [
        {
          type: "postRequest",
          source: "inline",
          lang: "js",
          content: `
            const all = response.cookies();
            client.global.set("COOKIE_COUNT", String(all.length));
            client.global.set("SESSION", response.cookiesByName("session")[0]?.value ?? "");
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
          "set-cookie": "session=xyz; Path=/",
          "content-type": "application/json",
        },
        body: "{}",
        timings: { phases: { total: 1 } },
      },
      vars,
      undefined,
      undefined,
      {
        phase: "postRequest",
        method: "GET",
        urlRaw: "https://example.com",
        headersRaw: {},
        bodyRaw: undefined,
        env: "default",
        startDir: "/tmp",
        mutableVars: vars,
        iteration: 1,
        responseUrl: "https://example.com",
        responseHeaders: {
          "set-cookie": "session=xyz; Path=/",
        },
      },
    );
    expect(vars.COOKIE_COUNT).toBe("1");
    expect(vars.SESSION).toBe("xyz");
  });

  test("pre-request JS can read request.method and request.body.getRaw", async () => {
    const blockWithBody: KulalaBlock = {
      ...dummyBlock,
      request: {
        ...dummyBlock.request,
        method: "PUT",
        body: "hello {{NAME}}",
      },
    };
    const vars: Record<string, string> = { NAME: "world" };
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
          lang: "js",
          content: `
            request.variables.set("METHOD", request.method);
            request.variables.set("RAW", request.body.getRaw() ?? "");
            request.variables.set("SUB", request.body.tryGetSubstituted() ?? "");
          `,
          lineNumber: 1,
        },
      ],
      "preRequest",
      blockWithBody,
      "/tmp/example.http",
      undefined,
      vars,
    );
    expect(vars.METHOD).toBe("PUT");
    expect(vars.RAW).toBe("hello {{NAME}}");
    expect(vars.SUB).toBe("hello world");
  });

  test("$kulala.prompt returns stored value without prompting", async () => {
    const vars: Record<string, string> = { keepassxc_password: "secret" };
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
          lang: "js",
          content: `
            const pwd = $kulala.prompt("Password?", "keepassxc_password", { type: "password" });
            request.variables.set("GOT", pwd);
          `,
          lineNumber: 1,
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      vars,
      undefined,
      undefined,
      undefined,
      { stableDocId: "stable-doc" },
    );
    expect(vars.GOT).toBe("secret");
  });

  test("$kulala.prompt throws ScriptPromptError when variable is missing", async () => {
    try {
      await runScripts(
        [
          {
            type: "preRequest",
            source: "inline",
            lang: "js",
            content: `$kulala.prompt("Your name?", "name");`,
            lineNumber: 1,
          },
        ],
        "preRequest",
        dummyBlock,
        "/tmp/example.http",
        undefined,
        {},
        undefined,
        undefined,
        undefined,
        { stableDocId: "stable-doc" },
      );
      throw new Error("expected ScriptPromptError");
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptPromptError);
      const err = e as ScriptPromptError;
      expect(err.promptResponse.prompt).toBe(true);
      expect(err.promptResponse.inputs[0]?.id).toBe("name");
      expect(err.promptResponse.inputs[0]?.label).toBe("Your name?");
      expect(err.promptResponse.inputs[0]?.type).toBe("text");
    }
  });

  test("$kulala.request.skip throws ScriptSkipError in pre-request", async () => {
    try {
      await runScripts(
        [
          {
            type: "preRequest",
            source: "inline",
            lang: "js",
            content: `$kulala.request.skip();`,
            lineNumber: 1,
          },
        ],
        "preRequest",
        dummyBlock,
        "/tmp/example.http",
        undefined,
        {},
        undefined,
        undefined,
        undefined,
        { stableDocId: "stable-doc" },
      );
      throw new Error("expected ScriptSkipError");
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptSkipError);
    }
  });

  test("$kulala.request.replay throws ScriptReplayError", async () => {
    try {
      await runScripts(
        [
          {
            type: "preRequest",
            source: "inline",
            lang: "js",
            content: `$kulala.request.replay();`,
            lineNumber: 1,
          },
        ],
        "preRequest",
        dummyBlock,
        "/tmp/example.http",
        undefined,
        {},
      );
      throw new Error("expected ScriptReplayError");
    } catch (e) {
      expect(e).toBeInstanceOf(ScriptReplayError);
    }
  });

  test("$kulala.request.skip is not available in post-request scripts", async () => {
    await expect(
      runScripts(
        [
          {
            type: "postRequest",
            source: "inline",
            lang: "js",
            content: `$kulala.request.skip();`,
            lineNumber: 1,
          },
        ],
        "postRequest",
        dummyBlock,
        "/tmp/example.http",
        {
          statusCode: 200,
          headers: {},
          body: "",
          timings: { phases: { total: 1 } },
        },
        {},
      ),
    ).rejects.toThrow(/pre-request/);
  });

  test("scriptConsole lines include origin (phase, source, file, directive line)", async () => {
    const scriptConsole: import("./types").KulalaScriptConsoleLine[] = [];
    await runScripts(
      [
        {
          type: "preRequest",
          source: "inline",
          lang: "js",
          content: `client.log("from-pre");`,
          lineNumber: 0,
          filepath: "example.http",
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      {},
      undefined,
      scriptConsole,
    );

    expect(scriptConsole).toHaveLength(1);
    expect(scriptConsole[0]?.message).toBe("from-pre");
    expect(scriptConsole[0]?.origin.phase).toBe("preRequest");
    expect(scriptConsole[0]?.origin.source).toBe("inline");
    expect(scriptConsole[0]?.origin.httpDirectiveLine).toBe(
      dummyBlock.position.start,
    );
    expect(scriptConsole[0]?.origin.file).toContain("example.http");
  });

  test("client.log works for file scripts in pre-request phase", async () => {
    const scriptConsole: import("./types").KulalaScriptConsoleLine[] = [];
    await runScripts(
      [
        {
          type: "preRequest",
          source: "file",
          lang: "js",
          content: `client.log("from-file");`,
          lineNumber: 0,
          filepath: "scripts/pre.js",
        },
      ],
      "preRequest",
      dummyBlock,
      "/tmp/example.http",
      undefined,
      {},
      undefined,
      scriptConsole,
    );

    expect(scriptConsole).toHaveLength(1);
    expect(scriptConsole[0]?.message).toBe("from-file");
    expect(scriptConsole[0]?.origin.phase).toBe("preRequest");
    expect(scriptConsole[0]?.origin.source).toBe("file");
    expect(scriptConsole[0]?.origin.file).toContain("scripts/pre.js");
  });
});
