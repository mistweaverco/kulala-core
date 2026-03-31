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

test("getRequest: invalid HTTP version (HTTP/3) is omitted from httpVersion", () => {
  const lines = ["GET https://example.com/ HTTP/3"];
  const [result] = getRequest(lines, 0);
  expect(result).not.toHaveProperty("errorMessage");
  if (!("errorMessage" in result!)) {
    expect(result.httpVersion).toBeUndefined();
  }
});
