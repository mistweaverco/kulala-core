export type HeadersDump = {
  statusCode: number;
  headers: Record<string, string>;
  /** Protocol version from the status line (e.g. HTTP/2). */
  httpVersion?: string;
};

const STATUS_LINE_RE = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})/;

/** Parse curl `--dump-header` output (last HTTP/* block wins). */
export function headersFromDump(dump: string): HeadersDump {
  const normalized = dump.replace(/\r\n/g, "\n");
  const blocks = normalized
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("HTTP/"));
  const last = blocks.length ? blocks[blocks.length - 1] : "";
  if (!last) return { statusCode: 0, headers: {} };

  const lines = last.split("\n").filter(Boolean);
  const statusLine = lines[0] ?? "";
  const m = statusLine.match(STATUS_LINE_RE);
  const httpVersion = m?.[1];
  const statusCode = m ? parseInt(m[2], 10) : 0;

  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    if (!k) continue;
    if (k === "set-cookie") {
      headers[k] = headers[k] ? `${headers[k]}\n${v}` : v;
    } else {
      headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
    }
  }
  return {
    statusCode,
    headers,
    ...(httpVersion ? { httpVersion } : {}),
  };
}
