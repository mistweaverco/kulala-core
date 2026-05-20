import { splitShellArgs } from "./shell-args";
import type { CurlHttpSpec, CurlParsedRequest } from "./types";

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function trimExtraSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
): void {
  headers[normalizeHeaderName(name)] = trimExtraSpace(value);
}

function cutHeader(line: string): [string, string] {
  const idx = line.indexOf(":");
  if (idx === -1) return [line, ""];
  return [line.slice(0, idx), line.slice(idx + 1)];
}

/**
 * Parse a curl command line into request fields (JetBrains / kulala paste-from-curl).
 */
export function parseCurlCommand(curl: string): CurlParsedRequest | null {
  if (!curl?.trim()) return null;

  let line = curl
    .replace(/\\\r?\n/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = splitShellArgs(line);
  if (parts.length === 0 || !parts[0]!.toLowerCase().startsWith("curl")) {
    return null;
  }

  const cmd: {
    method: string;
    headers: Record<string, string>;
    cookie: string;
    body: string[];
    url: string;
    httpVersion: string;
    previousFlag: string | null;
  } = {
    method: "",
    headers: {},
    cookie: "",
    body: [],
    url: "",
    httpVersion: "",
    previousFlag: null,
  };

  const methodFlags = new Set(["-X", "--request"]);
  const uaFlags = new Set(["-A", "--user-agent"]);
  const cookieFlags = new Set(["-b", "--cookie"]);
  const headerFlags = new Set(["-H", "--header"]);
  const bodyFlags = new Set([
    "-d",
    "--data",
    "--data-raw",
    "--json",
    "--data-binary",
    "--data-urlencode",
  ]);

  for (const part of parts.slice(1)) {
    if (part.startsWith("-")) {
      cmd.previousFlag = part;
      if (part.startsWith("--http")) {
        const ver = part.match(/[\d.]+/)?.[0];
        if (ver) cmd.httpVersion = `HTTP/${ver}`;
      }
      if (part === "--json") {
        setHeader(cmd.headers, "content-type", "application/json");
        setHeader(cmd.headers, "accept", "application/json");
      }
      continue;
    }

    const flag = cmd.previousFlag;
    if (
      !part.includes("curl") &&
      /^[a-z][a-z0-9+.-]*:\/\//i.test(part) &&
      !cmd.url
    ) {
      cmd.url = part;
    } else if (flag && headerFlags.has(flag)) {
      const [k, v] = cutHeader(part);
      setHeader(cmd.headers, k, v);
    } else if (flag && uaFlags.has(flag)) {
      setHeader(cmd.headers, "user-agent", part);
    } else if (flag && bodyFlags.has(flag)) {
      cmd.body.push(part);
    } else if (flag && cookieFlags.has(flag)) {
      cmd.cookie = part;
    } else if (flag && methodFlags.has(flag)) {
      cmd.method = part.toUpperCase();
    } else if (flag) {
      // ignore unknown flag values
    }
    cmd.previousFlag = null;
  }

  if (cmd.body.length > 0 && !cmd.headers["content-type"]) {
    setHeader(cmd.headers, "content-type", "application/x-www-form-urlencoded");
  }

  const method = cmd.method || (cmd.body.length > 0 ? "POST" : "GET");

  return {
    method,
    url: cmd.url,
    headers: cmd.headers,
    cookie: cmd.cookie,
    body: cmd.body,
    httpVersion: cmd.httpVersion,
  };
}

/** Build .http file lines from a parsed curl command. */
export function curlToHttpFileLines(
  parsed: CurlParsedRequest,
  originalCurl?: string,
): string[] {
  const lines: string[] = [];
  if (originalCurl) lines.push(`# ${originalCurl}`);
  const versionSuffix =
    parsed.httpVersion && parsed.httpVersion.length > 0
      ? ` ${parsed.httpVersion}`
      : "";
  lines.push(`${parsed.method} ${parsed.url}${versionSuffix}`);

  const headerNames = Object.keys(parsed.headers).sort();
  for (const lc of headerNames) {
    const value = parsed.headers[lc]!;
    const name =
      lc === "content-type"
        ? "Content-Type"
        : lc === "user-agent"
          ? "User-Agent"
          : lc.charAt(0).toUpperCase() + lc.slice(1);
    lines.push(`${name}: ${value}`);
  }
  if (parsed.cookie) lines.push(`Cookie: ${parsed.cookie}`);

  if (parsed.body.length > 0) {
    lines.push("");
    for (let i = 0; i < parsed.body.length; i++) {
      const part = parsed.body[i]!;
      lines.push(i < parsed.body.length - 1 ? `${part}&` : part);
    }
  }
  return lines;
}

export function parseCurlToHttpSpec(curl: string): {
  spec: CurlHttpSpec;
  curlOneLiner: string;
} | null {
  const parsed = parseCurlCommand(curl);
  if (!parsed || !parsed.url) return null;
  return {
    spec: {
      method: parsed.method,
      url: parsed.url,
      headers: parsed.headers,
      cookie: parsed.cookie,
      bodyLines: parsed.body,
      httpVersion: parsed.httpVersion,
    },
    curlOneLiner: curl
      .replace(/\\\r?\n/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}
