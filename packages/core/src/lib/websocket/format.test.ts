import { describe, expect, test } from "bun:test";
import { formatWebsocatCommand } from "./format";

describe("formatWebsocatCommand", () => {
  test("formats URL without body", () => {
    const cmd = formatWebsocatCommand({
      url: "wss://ws.ifelse.io",
    });
    expect(cmd).toBe("websocat 'wss://ws.ifelse.io' --text");
  });

  test("formats headers and piped body", () => {
    const cmd = formatWebsocatCommand({
      url: "wss://ws.ifelse.io",
      headers: { Authorization: "Bearer token" },
      body: '{"name":"world"}',
    });
    expect(cmd).toContain("printf '%s'");
    expect(cmd).toContain('{"name":"world"}');
    expect(cmd).toContain("websocat 'wss://ws.ifelse.io' --text");
    expect(cmd).toContain("-H");
    expect(cmd).toContain("Authorization");
    expect(cmd).toContain("wss://ws.ifelse.io");
  });

  test("normalizes bare host to wss URL", () => {
    const cmd = formatWebsocatCommand({
      url: "echo.websocket.org",
    });
    expect(cmd).toContain("'wss://echo.websocket.org' --text");
  });
});
