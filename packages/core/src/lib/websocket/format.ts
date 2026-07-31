import { shellQuote } from "../shell-quote";

export type WebsocatFormatInput = {
  url: string;
  headers?: Record<string, string>;
  body?: string;
};

function normalizeWsUrl(url: string): string {
  const t = url.trim();
  if (/^wss?:\/\//i.test(t)) return t;
  return `wss://${t}`;
}

function websocatArgs(input: WebsocatFormatInput): string[] {
  const parts: string[] = [
    "websocat",
    shellQuote(normalizeWsUrl(input.url)),
    "--text",
  ];
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    parts.push("-H", shellQuote(`${k}: ${v}`, true));
  }
  return parts;
}

/**
 * Format a resolved WebSocket request as a copy-pasteable websocat command.
 */
export function formatWebsocatCommand(input: WebsocatFormatInput): string {
  const body = input.body?.trim();
  if (!body) return websocatArgs(input).join(" ");
  const cmd = websocatArgs(input).join(" ");
  return `echo ${shellQuote(body)} | ${cmd}`;
}
