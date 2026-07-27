import { createInterface } from "node:readline";
import { normalizeSentPayload } from "./display";

export type WebSocketConnectOptions = {
  url: string;
  body?: string;
  headers?: Record<string, string>;
};

type OutboundMessage =
  | { type: "ready" }
  | { type: "message"; data: string }
  | { type: "sent"; data: string }
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

function errorEventMessage(ev: Event): string {
  if (ev instanceof ErrorEvent) {
    if (ev.message) return ev.message;
    const nested = (ev as ErrorEvent & { error?: unknown }).error;
    if (nested instanceof Error && nested.message) return nested.message;
    if (typeof nested === "string" && nested) return nested;
  }
  return "WebSocket error";
}

function closeCodeHint(code: number): string {
  if (code === 1002) return "WebSocket handshake failed (protocol error)";
  if (code === 1006) return "WebSocket connection closed abnormally";
  return `WebSocket closed before handshake (code ${code})`;
}

/** Read HTTP status/body when the server rejects the WebSocket upgrade (e.g. 429 rate limit). */
async function describeHandshakeFailure(url: string): Promise<string> {
  const httpUrl = url.replace(/^ws/i, "http");
  try {
    const res = await fetch(httpUrl, {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
      redirect: "manual",
    });
    if (res.status === 101) {
      return "WebSocket handshake failed unexpectedly";
    }
    const body = (await res.text()).trim();
    if (body) return `HTTP ${res.status}: ${body}`;
    return `HTTP ${res.status} (expected 101 Switching Protocols)`;
  } catch (e) {
    return e instanceof Error ? e.message : "WebSocket handshake failed";
  }
}

function isGenericHandshakeError(message: string): boolean {
  return (
    message === "WebSocket error" ||
    message.includes("Expected 101") ||
    message.includes("Unexpected server response")
  );
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
    let opened = false;
    let errorSent = false;
    let handshakeError: Promise<void> | undefined;

    const cleanup = () => {
      rl.close();
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    const emitHandshakeError = async (fallback: string): Promise<void> => {
      if (errorSent) return;
      errorSent = true;
      let message = fallback;
      if (isGenericHandshakeError(fallback)) {
        message = await describeHandshakeFailure(url);
      }
      writeOutbound({ type: "error", error: message });
    };

    const sendPayload = (data: string) => {
      const payload = data.endsWith("\n") ? data : data + "\n";
      ws.send(payload);
      writeOutbound({ type: "sent", data: normalizeSentPayload(data) });
    };

    ws.addEventListener("open", () => {
      opened = true;
      writeOutbound({ type: "ready" });
      if (connect.body && connect.body.trim()) {
        sendPayload(connect.body);
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

    ws.addEventListener("error", (ev) => {
      handshakeError = emitHandshakeError(errorEventMessage(ev));
    });

    ws.addEventListener("close", (ev) => {
      void (async () => {
        if (!opened) {
          if (handshakeError) {
            await handshakeError;
          } else if (!errorSent) {
            await emitHandshakeError(closeCodeHint(ev.code));
          }
        }
        writeOutbound({ type: "closed", code: ev.code });
        cleanup();
        resolve();
      })();
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
          sendPayload(cmd.data);
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
