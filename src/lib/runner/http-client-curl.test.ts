import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import {
  createServer as createHttp2Server,
  type Http2Server,
} from "node:http2";
import { nodeHttpRequest } from "./http-client";
import { resolveCurlPath } from "./embedded-curl";

async function hasCurl(): Promise<boolean> {
  try {
    await resolveCurlPath();
    return true;
  } catch {
    return false;
  }
}

function listenHttp(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no address"));
    });
  });
}

function listenHttp2(server: Http2Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no address"));
    });
  });
}

describe("curl transport", () => {
  test("forces HTTP/1.0 when requested", async () => {
    if (!(await hasCurl())) return;

    let seenVersion: string | undefined;
    const server = createServer((req, res) => {
      seenVersion = req.httpVersion;
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("ok");
    });
    const port = await listenHttp(server);

    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${port}/`,
      method: "GET",
      headers: {},
      httpVersion: "HTTP/1.0",
    });

    server.close();
    expect(res.statusCode).toBe(200);
    expect(seenVersion).toBe("1.0");
  });

  test("follows redirects and returns final url", async () => {
    if (!(await hasCurl())) return;

    const server = createServer((req, res) => {
      if (req.url === "/") {
        res.statusCode = 302;
        res.setHeader("location", "/final");
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("final");
    });
    const port = await listenHttp(server);

    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${port}/`,
      method: "GET",
      headers: {},
    });

    server.close();
    expect(res.statusCode).toBe(200);
    expect(res.url).toContain("/final");
    expect(res.timings.phases.redirect).toBeGreaterThanOrEqual(0);
    expect(res.timings.phases.total).toBeGreaterThanOrEqual(0);
  });

  test("supports HTTP/2 (h2c prior knowledge) locally", async () => {
    if (!(await hasCurl())) return;

    const server = createHttp2Server();
    server.on("stream", (stream) => {
      stream.respond({ ":status": 200, "content-type": "text/plain" });
      stream.end("h2");
    });
    const port = await listenHttp2(server);

    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${port}/`,
      method: "GET",
      headers: {},
      httpVersion: "HTTP/2",
    });

    server.close();
    expect(res.statusCode).toBe(200);
    expect(res.timings.phases.total).toBeGreaterThanOrEqual(0);
  });
});
