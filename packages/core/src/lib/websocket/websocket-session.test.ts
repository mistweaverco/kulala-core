import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type OutboundMessage = {
  type: string;
  data?: string;
  error?: string;
  code?: number;
};

async function readAllStdout(
  stream: ReadableStream<Uint8Array>,
): Promise<OutboundMessage[]> {
  const events: OutboundMessage[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) events.push(JSON.parse(line) as OutboundMessage);
    }
  }

  return events;
}

describe("runWebSocketSession", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  test("emits sent for initial body and stdin send", async () => {
    server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req, { data: undefined })) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open() {},
        message(ws, message) {
          ws.send(String(message));
        },
      },
    });

    const dir = mkdtempSync(join(tmpdir(), "kulala-ws-test-"));
    const connectFile = join(dir, "connect.json");
    writeFileSync(
      connectFile,
      JSON.stringify({
        url: `ws://127.0.0.1:${server.port}`,
        body: '{"name":"world"}',
      }),
    );

    const cliPath = join(import.meta.dir, "../../cli.ts");
    const child = Bun.spawn(
      ["bun", cliPath, "--websocket", "-i", connectFile],
      {
        cwd: join(import.meta.dir, "../../../.."),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const eventsPromise = readAllStdout(child.stdout);

    await Bun.sleep(200);
    child.stdin.write(`${JSON.stringify({ op: "send", data: '{"foo":1}' })}\n`);
    await Bun.sleep(200);
    child.stdin.write(`${JSON.stringify({ op: "close" })}\n`);
    child.stdin.end();

    const events = await eventsPromise;
    expect(await child.exited).toBe(0);

    expect(events.map((e) => e.type)).toEqual([
      "ready",
      "sent",
      "message",
      "sent",
      "message",
      "closed",
    ]);
    expect(events.filter((e) => e.type === "sent").map((e) => e.data)).toEqual([
      '{"name":"world"}',
      '{"foo":1}',
    ]);
  }, 15000);
});
