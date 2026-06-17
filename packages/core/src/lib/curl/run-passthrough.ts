import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import type { HttpRequestTimings } from "../runner/http-client";
import { resolveCurlPath } from "../runner/embedded-curl";
import { kulalaUserAgent } from "../runner/headers";
import { parseCurlCommand } from "./parse";
import { headersFromDump } from "./headers-dump";

type CurlWriteOut = {
  http_code: number;
  url_effective: string;
  time_namelookup: number;
  time_connect: number;
  time_appconnect: number;
  time_pretransfer: number;
  time_starttransfer: number;
  time_total: number;
  time_redirect: number;
};

export type CurlPassthroughResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
  method: string;
  timings: HttpRequestTimings;
  httpVersion?: string;
  verboseTrace?: string;
};

const STRIP_FLAGS = new Set([
  "-o",
  "--output",
  "-O",
  "--remote-name",
  "-D",
  "--dump-header",
  "-w",
  "--write-out",
  "-i",
  "--include",
  "-s",
  "--silent",
  "-#",
  "--progress-bar",
]);

const FLAGS_WITH_VALUE = new Set([
  "-o",
  "--output",
  "-O",
  "--remote-name",
  "-D",
  "--dump-header",
  "-w",
  "--write-out",
  "-H",
  "--header",
  "-X",
  "--request",
  "-A",
  "--user-agent",
  "-b",
  "--cookie",
  "-d",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--json",
  "-u",
  "--user",
  "-e",
  "--referer",
  "-F",
  "--form",
  "-T",
  "--upload-file",
  "--connect-timeout",
  "--max-time",
  "--retry",
  "--retry-delay",
  "--retry-max-time",
  "--cacert",
  "--capath",
  "--cert",
  "--key",
  "--pass",
  "--proxy",
  "--proxy-user",
  "--resolve",
  "--tlsuser",
  "--tlspassword",
  "--tlsauthtype",
]);

function curlArgvHasFlag(argv: string[], ...flags: string[]): boolean {
  return argv.some((arg) => {
    if (flags.includes(arg)) return true;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      return flags.includes(arg.slice(0, eq));
    }
    return false;
  });
}

/** True when argv already sets User-Agent via -A/--user-agent or -H/--header. */
export function curlArgvHasUserAgent(argv: string[]): boolean {
  const uaFlags = new Set(["-A", "--user-agent"]);
  const headerFlags = new Set(["-H", "--header"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const { flag, inlineValue } = splitFlagValue(arg);

    if (uaFlags.has(flag)) {
      return true;
    }

    if (headerFlags.has(flag)) {
      const headerLine = inlineValue ?? argv[i + 1];
      if (headerLine) {
        const colon = headerLine.indexOf(":");
        if (colon !== -1) {
          const name = headerLine.slice(0, colon).trim().toLowerCase();
          if (name === "user-agent") return true;
        }
        if (inlineValue === undefined) i += 1;
      }
    }
  }

  return false;
}

/** Prepend kulala-core User-Agent when argv does not already set one. */
export function ensureKulalaUserAgentInCurlArgv(argv: string[]): string[] {
  if (curlArgvHasUserAgent(argv)) return argv;
  return ["-A", kulalaUserAgent(), ...argv];
}

function splitFlagValue(arg: string): { flag: string; inlineValue?: string } {
  const eq = arg.indexOf("=");
  if (arg.startsWith("--") && eq > 0) {
    return { flag: arg.slice(0, eq), inlineValue: arg.slice(eq + 1) };
  }
  if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
    return { flag: arg.slice(0, 2), inlineValue: arg.slice(2) };
  }
  return { flag: arg };
}

/** Remove curl flags that conflict with kulala response capture. */
export function stripConflictingCurlFlags(argv: string[]): string[] {
  const out: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "curl") {
      continue;
    }

    const { flag, inlineValue } = splitFlagValue(arg);
    if (STRIP_FLAGS.has(flag)) {
      if (inlineValue === undefined && FLAGS_WITH_VALUE.has(flag)) {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          i += 1;
        }
      }
      continue;
    }

    out.push(arg);
  }

  return out;
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,?=&-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function inferRequest(argv: string[]): {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
} {
  const parsed = parseCurlCommand(`curl ${argv.map(quoteShellArg).join(" ")}`);
  if (!parsed?.url) {
    return { method: "GET", url: "", headers: {} };
  }

  const headOnly = curlArgvHasFlag(argv, "-I", "--head");
  return {
    method: headOnly ? "HEAD" : parsed.method,
    url: parsed.url,
    headers: parsed.headers,
    body: parsed.body.length > 0 ? parsed.body.join("&") : undefined,
  };
}

function parseCurlWriteOut(stdout: string): CurlWriteOut {
  const out: Partial<Record<keyof CurlWriteOut, string>> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq) as keyof CurlWriteOut;
    out[k] = line.slice(eq + 1);
  }

  const num = (k: keyof CurlWriteOut): number => {
    const raw = out[k];
    if (raw == null || raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    http_code: Math.trunc(num("http_code")),
    url_effective: out.url_effective ?? "",
    time_namelookup: num("time_namelookup"),
    time_connect: num("time_connect"),
    time_appconnect: num("time_appconnect"),
    time_pretransfer: num("time_pretransfer"),
    time_starttransfer: num("time_starttransfer"),
    time_total: num("time_total"),
    time_redirect: num("time_redirect"),
  };
}

function secondsToMs(sec: number): number {
  if (!Number.isFinite(sec) || sec < 0) return 0;
  return sec * 1000;
}

function buildTimings(w: CurlWriteOut): HttpRequestTimings {
  const dns = secondsToMs(w.time_namelookup);
  const connect = secondsToMs(w.time_connect);
  const appconnect = secondsToMs(w.time_appconnect);
  const pretransfer = secondsToMs(w.time_pretransfer);
  const startTransfer = secondsToMs(w.time_starttransfer);
  const total = secondsToMs(w.time_total);
  const redirect = secondsToMs(w.time_redirect);

  const tcp = Math.max(0, connect - dns);
  const tls =
    appconnect > 0 && connect > 0 ? Math.max(0, appconnect - connect) : 0;
  const request = Math.max(0, pretransfer - (dns + tcp + tls));
  const firstByte = Math.max(0, startTransfer - pretransfer);

  return {
    phases: {
      dns,
      tcp,
      tls,
      request,
      firstByte,
      startTransfer,
      redirect,
      total,
    },
  };
}

async function runCurl(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const curlPath = await resolveCurlPath();
  const env = { ...process.env };
  if (!env.CURL_CA_BUNDLE) {
    try {
      const ca = join(dirname(curlPath), "curl-ca-bundle.crt");
      await access(ca, fsConstants.R_OK);
      env.CURL_CA_BUNDLE = ca;
    } catch {
      // ignore
    }
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(curlPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 0,
      });
    });
  });
}

export async function runCurlPassthrough(
  argv: string[],
): Promise<CurlPassthroughResult> {
  const userArgv = ensureKulalaUserAgentInCurlArgv(
    stripConflictingCurlFlags(argv),
  );
  const verbose = curlArgvHasFlag(userArgv, "-v", "--verbose");
  const headOnly = curlArgvHasFlag(userArgv, "-I", "--head");
  const request = inferRequest(userArgv);

  const tempBase = await fs.mkdtemp(join(tmpdir(), "kulala-curl-passthrough-"));
  const bodyPath = join(tempBase, `body-${randomUUID()}`);
  const headerPath = join(tempBase, `headers-${randomUUID()}`);

  const writeOut = [
    "http_code=%{http_code}",
    "url_effective=%{url_effective}",
    "time_namelookup=%{time_namelookup}",
    "time_connect=%{time_connect}",
    "time_appconnect=%{time_appconnect}",
    "time_pretransfer=%{time_pretransfer}",
    "time_starttransfer=%{time_starttransfer}",
    "time_total=%{time_total}",
    "time_redirect=%{time_redirect}",
    "",
  ].join("\n");

  const args: string[] = [
    ...(verbose ? [] : ["--silent"]),
    "--show-error",
    "--dump-header",
    headerPath,
    "--output",
    bodyPath,
    "--write-out",
    writeOut,
    ...userArgv,
  ];

  try {
    const { stdout, stderr, exitCode } = await runCurl(args);
    if (exitCode !== 0) {
      const msg = stderr.trim() || `curl failed with exit code ${exitCode}`;
      throw new Error(msg);
    }

    const w = parseCurlWriteOut(stdout);
    const dump = await fs.readFile(headerPath, "utf-8");
    const { statusCode, headers, httpVersion } = headersFromDump(dump);
    const body = headOnly ? Buffer.alloc(0) : await fs.readFile(bodyPath);

    return {
      statusCode: statusCode || w.http_code || 0,
      headers,
      body,
      url: w.url_effective || request.url,
      method: request.method,
      timings: buildTimings(w),
      verboseTrace: verbose ? stderr : undefined,
      ...(httpVersion ? { httpVersion } : {}),
    };
  } finally {
    await fs.rm(tempBase, { recursive: true, force: true });
  }
}
