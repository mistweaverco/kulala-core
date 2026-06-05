import { expect, test } from "bun:test";
import { getRequest } from "./request";

test("getRequest: single-line with HTTP/1.1 sets httpVersion", () => {
  const lines = ["GET https://example.com/ HTTP/1.1"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.method).toBe("GET");
    expect(result.url).toBe("https://example.com/");
    expect(result.httpVersion).toBe("HTTP/1.1");
  }
});

test("getRequest: single-line with HTTP/1.0 sets httpVersion", () => {
  const lines = ["POST https://api.example.com/upload HTTP/1.0"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.httpVersion).toBe("HTTP/1.0");
  }
});

test("getRequest: single-line with HTTP/2 sets httpVersion", () => {
  const lines = ["GET https://example.com/ HTTP/2"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.httpVersion).toBe("HTTP/2");
  }
});

test("getRequest: multi-line request with HTTP/1.1 on continuation line sets httpVersion", () => {
  const lines = ["GET https://example.com/", "    path", "    HTTP/1.1"];
  const [result, consumed] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  expect(consumed).toBe(3);
  if (!("errorMessage" in result!)) {
    expect(result.url).toBe("https://example.com/path");
    expect(result.httpVersion).toBe("HTTP/1.1");
  }
});

test("getRequest: multi-line request with URL part and HTTP/1.1 on same continuation line", () => {
  const lines = [
    "GET https://httpbin.org/get?foo=httpbin.org/get?foo=1",
    "  &bar=1 HTTP/1.1",
  ];
  const [result, consumed] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  expect(consumed).toBe(2);
  if (!("errorMessage" in result!)) {
    expect(result.url).toBe(
      "https://httpbin.org/get?foo=httpbin.org/get?foo=1&bar=1",
    );
    expect(result.httpVersion).toBe("HTTP/1.1");
    expect(result.httpVersionInline).toBe(true);
    expect(result.requestLineParts).toEqual([
      {
        type: "url",
        line: "https://httpbin.org/get?foo=httpbin.org/get?foo=1",
      },
      { type: "url", line: "&bar=1" },
    ]);
  }
});

test("getRequest: invalid HTTP version (HTTP/3) is omitted from httpVersion", () => {
  const lines = ["GET https://example.com/ HTTP/3"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.httpVersion).toBeUndefined();
  }
});

test("getRequest: full URL template on request line (POST {{API_URL}})", () => {
  const lines = ["POST {{API_URL}} HTTP/1.1"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.method).toBe("POST");
    expect(result.url).toBe("{{API_URL}}");
    expect(result.httpVersion).toBe("HTTP/1.1");
  }
});

test("getRequest: template with spaces inside braces on request line", () => {
  const lines = ["GET {{ base }}/items HTTP/1.1"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.url).toBe("{{ base }}/items");
  }
});

test("getRequest: rejects line with only HTTP version after method", () => {
  const lines = ["GET HTTP/1.1"];
  const [result] = getRequest(lines, 0);
  expect(result).toHaveProperty("errorMessage");
});
