import { describe, expect, test } from "bun:test";
import { prepareWebSocketConnect } from "./prepare-connect";

describe("prepareWebSocketConnect", () => {
  test("passes through already-resolved connect options", () => {
    expect(
      prepareWebSocketConnect({
        url: "wss://ws.ifelse.io",
        body: '{"name":"world"}',
      }),
    ).toEqual({
      url: "wss://ws.ifelse.io",
      body: '{"name":"world"}',
    });
  });

  test("substitutes variables when vars are provided", () => {
    expect(
      prepareWebSocketConnect({
        url: "{{websocket.addr}}",
        vars: { "websocket.addr": "wss://ws.ifelse.io" },
      }),
    ).toEqual({
      url: "wss://ws.ifelse.io",
    });
  });

  test("throws when templates remain and no vars are provided", () => {
    expect(() =>
      prepareWebSocketConnect({ url: "{{websocket.addr}}" }),
    ).toThrow(/unresolved/);
  });
});
