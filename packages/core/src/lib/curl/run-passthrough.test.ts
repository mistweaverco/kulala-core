import { describe, expect, test } from "bun:test";
import { version } from "../../../version.json";
import {
  curlArgvHasUserAgent,
  ensureKulalaUserAgentInCurlArgv,
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

describe("ensureKulalaUserAgentInCurlArgv", () => {
  const ua = `kulala-core/${version}`;

  test("adds default User-Agent when missing", () => {
    expect(ensureKulalaUserAgentInCurlArgv(["https://example.com"])).toEqual([
      "-A",
      ua,
      "https://example.com",
    ]);
  });

  test("does not override -A", () => {
    const argv = ["-A", "custom/1.0", "https://example.com"];
    expect(ensureKulalaUserAgentInCurlArgv(argv)).toEqual(argv);
    expect(curlArgvHasUserAgent(argv)).toBe(true);
  });

  test("does not override --user-agent", () => {
    const argv = ["--user-agent=custom/1.0", "https://example.com"];
    expect(ensureKulalaUserAgentInCurlArgv(argv)).toEqual(argv);
    expect(curlArgvHasUserAgent(argv)).toBe(true);
  });

  test("does not override -H User-Agent", () => {
    const argv = ["-H", "User-Agent: custom/1.0", "https://example.com"];
    expect(ensureKulalaUserAgentInCurlArgv(argv)).toEqual(argv);
    expect(curlArgvHasUserAgent(argv)).toBe(true);
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
