import { createInterface } from "node:readline";

export type WebSocketConnectOptions = {
  url: string;
  body?: string;
  headers?: Record<string, string>;
};

type OutboundMessage =
  | { type: "ready" }
  | { type: "message"; data: string }
  | { type: "error"; error: string }
  | { type: "closed"; code?: number };

function writeOutbound(msg: OutboundMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** DOM lib types only allow protocols as the 2nd arg; Bun accepts `{ headers }`. */
type BunClientWebSocket = {
  new (
    url: string | URL,
    options?: { headers?: Record<string, string> },
  ): WebSocket;
};

function openClientWebSocket(
  url: string,
  headers?: Record<string, string>,
): WebSocket {
  if (headers && Object.keys(headers).length > 0) {
    const Ws = WebSocket as unknown as BunClientWebSocket;
    return new Ws(url, { headers });
  }
  return new WebSocket(url);
}

function normalizeWsUrl(method: string, target: string): string {
  const t = target.trim();
  if (/^wss?:\/\//i.test(t)) return t;
  const scheme = method.toUpperCase() === "WSS" ? "wss" : "ws";
  return `${scheme}://${t}`;
}

/**
 * Long-lived WebSocket session for kulala.nvim (replaces websocat).
 * Invoked via `kulala-core --websocket -i <connect.json>`.
 * Reads JSON lines from stdin: `{ "op": "send", "data": "..." }`, `{ "op": "close" }`.
 */
export async function runWebSocketSession(
  connect: WebSocketConnectOptions,
): Promise<void> {
  const url = normalizeWsUrl("WS", connect.url);

  await new Promise<void>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = openClientWebSocket(url, connect.headers);
    } catch (e) {
      reject(e);
      return;
    }

    const rl = createInterface({ input: process.stdin, terminal: false });

    const cleanup = () => {
      rl.close();
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.addEventListener("open", () => {
      writeOutbound({ type: "ready" });
      if (connect.body && connect.body.trim()) {
        ws.send(
          connect.body.endsWith("\n") ? connect.body : connect.body + "\n",
        );
      }
    });

    ws.addEventListener("message", (ev) => {
      const data =
        typeof ev.data === "string"
          ? ev.data
          : ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : String(ev.data);
      writeOutbound({ type: "message", data });
    });

    ws.addEventListener("error", () => {
      writeOutbound({ type: "error", error: "WebSocket error" });
    });

    ws.addEventListener("close", (ev) => {
      writeOutbound({ type: "closed", code: ev.code });
      cleanup();
      resolve();
    });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const cmd = JSON.parse(trimmed) as { op?: string; data?: string };
        if (cmd.op === "close") {
          ws.close();
          cleanup();
          resolve();
          return;
        }
        if (cmd.op === "send" && cmd.data != null) {
          const payload = cmd.data.endsWith("\n") ? cmd.data : cmd.data + "\n";
          ws.send(payload);
        }
      } catch {
        writeOutbound({ type: "error", error: "Invalid stdin command JSON" });
      }
    });

    // Do not close the socket when stdin hits EOF. Neovim (and other parents) may
    // deliver EOF before the stdin pipe is fully wired; closing here disconnects
    // immediately with no echoed messages. Shutdown is driven by `{ op: "close" }`
    // or process termination.
  });
}
