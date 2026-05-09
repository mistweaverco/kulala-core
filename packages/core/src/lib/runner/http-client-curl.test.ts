import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Stream,
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
    expect(res.redirectChain).toBeUndefined();
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
    expect(res.redirectChain?.length).toBe(2);
    expect(res.redirectChain?.[0]?.statusCode).toBe(302);
    expect(res.redirectChain?.[1]?.statusCode).toBe(200);
    expect(res.timings.phases.redirect).toBeGreaterThanOrEqual(0);
    expect(res.timings.phases.total).toBeGreaterThanOrEqual(0);
  });

  test("keeps POST body across 301/302/303 redirects (GraphQL-style)", async () => {
    if (!(await hasCurl())) return;

    const server = createServer(async (req, res) => {
      if (req.url === "/start") {
        res.statusCode = 302;
        res.setHeader("location", "/graphql");
        res.end();
        return;
      }
      if (req.url === "/graphql") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (req.method !== "POST" || raw.trim() === "") {
          res.statusCode = 400;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ errors: [{ message: "Missing body" }] }));
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });

    const port = await listenHttp(server);
    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${port}/start`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query { __typename }" }),
    });

    server.close();
    expect(res.statusCode).toBe(200);
  });

  test("supports HTTP/2 (h2c prior knowledge) locally", async () => {
    if (!(await hasCurl())) return;

    const server = createHttp2Server();
    server.on("stream", (stream: ServerHttp2Stream) => {
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

  test("cross-host redirect does not forward client Cookie or host-only Set-Cookie", async () => {
    if (!(await hasCurl())) return;

    let cookieSeenOnB = "";
    const serverB = createServer((req, res) => {
      cookieSeenOnB = req.headers.cookie ?? "";
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("b");
    });
    const portB = await listenHttp(serverB);

    const serverA = createServer((req, res) => {
      if (req.url === "/") {
        res.statusCode = 302;
        // `localhost` vs `127.0.0.1`: different URL hosts so client cookies are not replayed.
        res.setHeader("location", `http://localhost:${portB}/on-b`);
        res.setHeader("set-cookie", "from_a=1; Path=/");
        res.end();
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const portA = await listenHttp(serverA);

    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${portA}/`,
      method: "GET",
      headers: { Cookie: "client_only=1" },
    });

    serverA.close();
    serverB.close();

    expect(res.statusCode).toBe(200);
    expect(cookieSeenOnB).toBe("");
  });

  test("same-host redirect still sends client Cookie and Set-Cookie applies on next hop", async () => {
    if (!(await hasCurl())) return;

    let cookieOnFinal = "";
    const server = createServer((req, res) => {
      if (req.url === "/" || req.url?.startsWith("/?")) {
        res.statusCode = 302;
        res.setHeader("location", "/final");
        res.setHeader("set-cookie", "from_redirect=1; Path=/");
        res.end();
        return;
      }
      if (req.url === "/final") {
        cookieOnFinal = req.headers.cookie ?? "";
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const port = await listenHttp(server);

    const res = await nodeHttpRequest({
      url: `http://127.0.0.1:${port}/`,
      method: "GET",
      headers: { Cookie: "client=xyz" },
    });

    server.close();

    expect(res.statusCode).toBe(200);
    expect(cookieOnFinal).toContain("client=xyz");
    expect(cookieOnFinal).toContain("from_redirect=1");
  });
});
