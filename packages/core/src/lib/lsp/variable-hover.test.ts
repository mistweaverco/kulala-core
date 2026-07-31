import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { lspHover } from "./index";
import { variableReferenceAtCursor } from "./variable-hover";

const websocketExamplePath = join(
  import.meta.dir,
  "../../../../../http-example-files/websocket.http",
);

describe("variableReferenceAtCursor", () => {
  test("returns variable name when cursor is inside braces", () => {
    const line = "WEBSOCKET {{websocket.addr}}";
    expect(variableReferenceAtCursor(line, 16)).toBe("websocket.addr");
  });

  test("returns null when cursor is outside braces", () => {
    expect(variableReferenceAtCursor("GET https://example.com", 5)).toBeNull();
  });
});

describe("lspVariableHover", () => {
  test("resolves env-backed variables from websocket.http", async () => {
    const content = readFileSync(websocketExamplePath, "utf8");
    const hover = await lspHover({
      content,
      filepath: websocketExamplePath,
      env: "default",
      line: 3,
      column: 18,
    });
    expect(hover.contents).toMatchObject({
      language: "http",
      value:
        'echo \'{"message":"Hello world!"}\' | websocat \'wss://echo.kulala.app/ws\' --text -H "User-Agent: kulala-core/0.0.0-local" -H "X-Kulala-Shared-Default-Header: kulala-family"',
    });
  });

  test("returns unresolved template when variable is unknown", async () => {
    const content = `GET https://example.com/{{UNKNOWN_VAR}} HTTP/1.1`;
    const hover = await lspHover({
      content,
      filepath: "/tmp/unknown.http",
      env: "default",
      line: 1,
      column: 30,
    });
    expect(hover.contents).toMatchObject({
      kind: "plaintext",
      value: "{{UNKNOWN_VAR}}",
    });
  });
});
