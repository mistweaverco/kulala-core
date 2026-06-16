import { shellQuote } from "../shell-quote";
import { resolveGrpcPath } from "./resolve-path";
import { mergeGrpcFlags, parseGrpcAddress } from "./parse-target";
import type { KulalaGrpcCommand, KulalaGrpcFlag } from "./types";

const LOADER_FLAGS = new Set([
  "import-path",
  "proto",
  "protoset",
  "plaintext",
  "v",
]);

export type GrpcurlFormatInput = {
  grpcCommand: KulalaGrpcCommand;
  flags: KulalaGrpcFlag[];
  headers?: Record<string, string>;
  body?: string;
  cwd: string;
  vars?: Record<string, string>;
  insecure?: boolean;
};

function emitGrpcFlag(
  parts: string[],
  flag: string,
  value: string,
  cwd: string,
  vars: Record<string, string>,
): void {
  if (flag === "plaintext" || flag === "v") {
    parts.push(`-${flag}`);
    return;
  }
  const resolved =
    ["import-path", "proto", "protoset"].includes(flag) && value
      ? resolveGrpcPath(value, cwd, vars)
      : value;
  parts.push(`-${flag}`);
  if (resolved) parts.push(shellQuote(resolved));
}

/**
 * Format a resolved gRPC request as a copy-pasteable grpcurl command.
 */
export function formatGrpcurlCommand(input: GrpcurlFormatInput): string {
  const parsed = input.grpcCommand;
  const flags = mergeGrpcFlags(input.flags, parsed.inlineFlags);
  const vars = input.vars ?? {};
  const parts: string[] = ["grpcurl"];
  const address = parsed.address;
  if (!address) {
    throw new Error("gRPC request is missing server address (host:port)");
  }
  const { channelTarget, useTls } = parseGrpcAddress(address);
  const hasPlaintextFlag = flags.some(({ flag }) => flag === "plaintext");

  // grpcurl defaults to TLS; bare host:port in Kulala is plaintext (see parseGrpcAddress).
  if (!useTls && !hasPlaintextFlag) parts.push("-plaintext");
  // curl --insecure maps to grpcurl -insecure (skip cert verify), only for TLS connections.
  if (input.insecure && useTls && !hasPlaintextFlag) parts.push("-insecure");

  for (const { flag, value } of flags) {
    if (LOADER_FLAGS.has(flag)) {
      emitGrpcFlag(parts, flag, value, input.cwd, vars);
    } else {
      parts.push(`-${flag}`);
      if (value) parts.push(shellQuote(value, flag === "d"));
    }
  }

  for (const [k, v] of Object.entries(input.headers ?? {})) {
    parts.push("-H", shellQuote(`${k}: ${v}`, true));
  }

  const body = input.body?.trim();
  if (body) parts.push("-d", shellQuote(body, true));

  parts.push(shellQuote(channelTarget));

  if (parsed.command === "list") {
    parts.push("list");
  } else if (parsed.command === "describe") {
    parts.push("describe");
    if (parsed.symbol) parts.push(shellQuote(parsed.symbol));
  } else if (parsed.symbol) {
    parts.push(shellQuote(parsed.symbol));
  }

  return parts.join(" ");
}
