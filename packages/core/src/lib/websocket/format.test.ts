import { describe, expect, test } from "bun:test";
import { formatWebsocatCommand } from "./format";

describe("formatWebsocatCommand", () => {
  test("formats URL without body", () => {
    const cmd = formatWebsocatCommand({
      url: "wss://echo.kulala.app",
    });
    expect(cmd).toBe("websocat 'wss://echo.kulala.app' --text");
  });

  test("formats headers and piped body", () => {
    const cmd = formatWebsocatCommand({
      url: "wss://echo.kulala.app",
      headers: { Authorization: "Bearer token" },
      body: '{"name":"world"}',
    });
    expect(cmd).toContain("echo ");
    expect(cmd).toContain('{"name":"world"}');
    expect(cmd).toContain("websocat 'wss://echo.kulala.app' --text");
    expect(cmd).toContain("-H");
    expect(cmd).toContain("Authorization");
    expect(cmd).toContain("wss://echo.kulala.app");
  });

  test("normalizes bare host to wss URL", () => {
    const cmd = formatWebsocatCommand({
      url: "echo.kulala.app",
    });
    expect(cmd).toContain("'wss://echo.kulala.app' --text");
  });
});
