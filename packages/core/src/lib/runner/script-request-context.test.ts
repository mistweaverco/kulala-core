import { describe, expect, test } from "bun:test";
import {
  buildScriptCookies,
  buildScriptRequestApi,
  buildScriptRequestContextFromBlock,
  type PostRequestScriptApi,
  type PreRequestScriptApi,
} from "./script-request-context";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaHttpURL } from "../parser/types/request";

const block: KulalaBlock = {
  name: "REQ",
  errors: [],
  preamble: [],
  comments: [],
  operators: [],
  request: {
    method: "POST",
    url: "https://api.example.com/{{PATH}}" as KulalaHttpURL,
    headerSection: [
      { type: "header", name: "X-Token", value: "{{TOKEN}}" },
      { type: "header", name: "Content-Type", value: "application/json" },
    ],
    body: '{"id": "{{ID}}"}',
  },
  scripts: { preRequest: [], postRequest: [] },
  position: { start: 1, end: 1 },
};

describe("script-request-context", () => {
  test("pre-request exposes JetBrains request.body and request.url helpers", () => {
    const vars = { TOKEN: "secret", ID: "42" };
    const ctx = buildScriptRequestContextFromBlock({
      block,
      phase: "preRequest",
      effectiveBody: block.request.body,
      env: "default",
      startDir: "/tmp",
      mutableVars: vars,
      iteration: 0,
    });
    const req = buildScriptRequestApi(ctx) as PreRequestScriptApi;
    expect(req.method).toBe("POST");
    expect(req.body.getRaw()).toBe('{"id": "{{ID}}"}');
    expect(req.body.tryGetSubstituted()).toBe('{"id": "42"}');
    expect(req.url.getRaw()).toBe("https://api.example.com/{{PATH}}");
    expect(req.url.tryGetSubstituted()).toBe("https://api.example.com/");
    const h = req.headers.findByName("X-Token");
    expect(h?.getRawValue()).toBe("{{TOKEN}}");
    expect(h?.tryGetSubstituted()).toBe("secret");
    expect(req.iteration()).toBe(0);
  });

  test("post-request exposes JetBrains request.body() and request.url()", () => {
    const ctx = buildScriptRequestContextFromBlock({
      block,
      phase: "postRequest",
      effectiveBody: block.request.body,
      env: "default",
      startDir: "/tmp",
      mutableVars: {},
      iteration: 1,
      collectionPlan: {
        count: 3,
        collections: { id: [1, 2, 3] },
        primaryCollection: "id",
      },
      urlSent: "https://api.example.com/items",
      headersSent: { "Content-Type": "application/json" },
      bodySent: '{"id":"42"}',
    });
    const req = buildScriptRequestApi(ctx) as PostRequestScriptApi;
    expect(req.body()).toBe('{"id":"42"}');
    expect(req.url()).toBe("https://api.example.com/items");
    const h = req.headers.findByName("Content-Type");
    expect(h?.value()).toBe("application/json");
    expect(req.iteration()).toBe(1);
    expect(req.templateValue(0)).toBe(1);
    expect(req.templateValue(2)).toBe(3);
  });

  test("response cookies from Set-Cookie headers", () => {
    const cookies = buildScriptCookies(
      {
        "set-cookie": "session=abc; Path=/; HttpOnly\nuid=1; Path=/api",
      },
      "https://api.example.com/login",
    );
    expect(cookies).toHaveLength(2);
    expect(cookies[0]?.name).toBe("session");
    expect(cookies[0]?.value).toBe("abc");
    expect(cookies[1]?.name).toBe("uid");
  });
});
