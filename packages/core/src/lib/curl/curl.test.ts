import { describe, expect, test } from "bun:test";
import {
  curlHeaderArg,
  formatCurlCommand,
  parseCurlCommand,
  parseCurlToHttpSpec,
} from "./index";

describe("curlHeaderArg", () => {
  test("passes Content-Type; sentinel without colon for curl", () => {
    expect(curlHeaderArg("Content-Type;", "")).toBe("Content-Type;:");
    expect(curlHeaderArg("Content-Type", "application/json")).toBe(
      "Content-Type: application/json",
    );
  });
});

describe("curl parse", () => {
  test("parses simple GET", () => {
    const p = parseCurlCommand("curl 'http://example.com/get'");
    expect(p?.method).toBe("GET");
    expect(p?.url).toBe("http://example.com/get");
  });

  test("parses POST with JSON body and headers", () => {
    const cmd =
      "curl -X POST -H 'Content-Type:application/json' -d '{\"foo\":\"bar\"}' 'https://echo.kulala.app/post'";
    const p = parseCurlCommand(cmd);
    expect(p?.method).toBe("POST");
    expect(p?.headers["content-type"]).toBe("application/json");
    expect(p?.body[0]).toBe('{"foo":"bar"}');
    expect(p?.url).toBe("https://echo.kulala.app/post");
  });

  test("parses -u into Basic Authorization header", () => {
    const p = parseCurlCommand("curl -u alice:secret 'http://example.com/get'");
    expect(p?.headers["authorization"]).toBe("Basic alice:secret");
    expect(p?.url).toBe("http://example.com/get");
  });

  test("parses --user into Basic Authorization header", () => {
    const p = parseCurlCommand(
      "curl --user alice:secret 'http://example.com/get'",
    );
    expect(p?.headers["authorization"]).toBe("Basic alice:secret");
  });

  test("parses -u without password into Basic header with trailing colon", () => {
    const p = parseCurlCommand("curl -u alice 'http://example.com/get'");
    expect(p?.headers["authorization"]).toBe("Basic alice:");
  });

  test("parseCurlToHttpSpec returns http spec", () => {
    const r = parseCurlToHttpSpec("curl -X GET 'http://example.com' --http1.1");
    expect(r?.spec.method).toBe("GET");
    expect(r?.spec.url).toBe("http://example.com");
    expect(r?.spec.httpVersion).toBe("HTTP/1.1");
  });
});

describe("curl format", () => {
  test("formats POST with body", () => {
    const curl = formatCurlCommand({
      method: "POST",
      url: "http://localhost:3001/request_1",
      headers: {
        "Content-Type": "application/json",
        Cookie: "cookie_key=value",
      },
      body: '{"foo": "bar"}',
      userAgent: "kulala.nvim/4.10.0",
    });
    expect(curl).toContain("-X");
    expect(curl).toContain("POST");
    expect(curl).toContain("--data-binary");
    expect(curl).toContain("foo");
    expect(curl).toContain("--cookie");
    expect(curl).toContain("localhost:3001");
  });
});
