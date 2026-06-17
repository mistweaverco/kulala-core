import { describe, expect, test } from "bun:test";
import {
  runCurlPassthrough,
  stripConflictingCurlFlags,
} from "./run-passthrough";

describe("stripConflictingCurlFlags", () => {
  test("removes output flags that conflict with capture", () => {
    expect(
      stripConflictingCurlFlags([
        "-H",
        "Accept: */*",
        "-o",
        "/tmp/out",
        "-w",
        "%{http_code}",
        "https://example.com",
      ]),
    ).toEqual(["-H", "Accept: */*", "https://example.com"]);
  });

  test("removes leading curl token", () => {
    expect(
      stripConflictingCurlFlags(["curl", "-I", "https://example.com"]),
    ).toEqual(["-I", "https://example.com"]);
  });
});

describe("runCurlPassthrough", () => {
  test("runs HEAD requests", async () => {
    const res = await runCurlPassthrough(["-I", "https://echo.kulala.app/get"]);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
    expect(res.httpVersion).toMatch(/^HTTP\//);
    expect(res.method).toBe("HEAD");
    expect(res.url).toContain("echo.kulala.app");
    expect(res.headers["content-type"]).toBeTruthy();
  });
});
