import { describe, expect, test } from "bun:test";
import { headersFromDump } from "./headers-dump";

describe("headersFromDump", () => {
  test("parses HTTP/2 status line and headers", () => {
    const dump = [
      "HTTP/2 200",
      "content-type: image/jpeg",
      "server: Google Frontend",
      "",
    ].join("\n");
    const res = headersFromDump(dump);
    expect(res.statusCode).toBe(200);
    expect(res.httpVersion).toBe("HTTP/2");
    expect(res.headers["content-type"]).toBe("image/jpeg");
  });

  test("uses the last HTTP block after redirects", () => {
    const dump = [
      "HTTP/1.1 302 Found",
      "location: https://example.com/final",
      "",
      "HTTP/2 200",
      "content-type: text/plain",
      "",
    ].join("\n");
    const res = headersFromDump(dump);
    expect(res.statusCode).toBe(200);
    expect(res.httpVersion).toBe("HTTP/2");
    expect(res.headers["content-type"]).toBe("text/plain");
  });
});
