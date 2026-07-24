import type { KulalaGrpcCommand, KulalaGrpcFlag } from "./types";

/**
 * Parse the request target after `GRPC` (grpcurl-compatible tokenization).
 * @see https://kulala.app/usage/grpc
 */
export function parseGrpcTarget(target: string): KulalaGrpcCommand {
  const cmd: KulalaGrpcCommand = { inlineFlags: [] };
  let addressParsed = false;
  let previousFlag: string | null = null;

  for (const part of target.split(/\s+/).filter(Boolean)) {
    if (part.toUpperCase() === "GRPC") continue;

    if (part.includes(":") && !part.includes("=")) {
      cmd.address = part;
      addressParsed = true;
      continue;
    }

    if (part === "describe" || part === "list") {
      cmd.command = part;
      continue;
    }

    if (addressParsed && part.length > 0 && !part.startsWith("-")) {
      cmd.symbol = part;
      continue;
    }

    if (part.startsWith("-")) {
      previousFlag = part.slice(1);
      cmd.inlineFlags.push({ flag: previousFlag, value: "" });
      continue;
    }

    if (previousFlag) {
      const last = cmd.inlineFlags[cmd.inlineFlags.length - 1];
      if (last && last.flag === previousFlag && last.value === "") {
        last.value = part;
      } else {
        cmd.inlineFlags.push({ flag: previousFlag, value: part });
      }
      previousFlag = null;
    }
  }

  return cmd;
}

export function mergeGrpcFlags(
  ...groups: KulalaGrpcFlag[][]
): KulalaGrpcFlag[] {
  return groups.flat();
}

import { resolveGrpcPath } from "./resolve-path";

export function grpcFlagsToLoaderOptions(
  flags: KulalaGrpcFlag[],
  cwd: string,
  vars: Record<string, string> = {},
): {
  importPaths: string[];
  protoFiles: string[];
  protosetFiles: string[];
  plaintext: boolean;
  authority?: string;
} {
  const importPaths: string[] = [];
  const protoFiles: string[] = [];
  const protosetFiles: string[] = [];
  let plaintext = false;
  let authority: string | undefined;

  for (const { flag, value } of flags) {
    switch (flag) {
      case "import-path":
        if (value) importPaths.push(resolveGrpcPath(value, cwd, vars));
        break;
      case "proto":
        if (value) protoFiles.push(resolveGrpcPath(value, cwd, vars));
        break;
      case "protoset":
        if (value) protosetFiles.push(resolveGrpcPath(value, cwd, vars));
        break;
      case "plaintext":
        plaintext = true;
        break;
      case "authority":
        if (value) authority = value;
        break;
      default:
        break;
    }
  }

  return { importPaths, protoFiles, protosetFiles, plaintext, authority };
}

/** Channel options for grpcurl-compatible `-authority` / `# @grpc-authority`. */
export function grpcChannelOptionsForAuthority(
  authority?: string,
): Record<string, string> | undefined {
  if (!authority) return undefined;
  return {
    "grpc.ssl_target_name_override": authority,
    "grpc.default_authority": authority,
  };
}

/** `helloworld.Greeter/SayHello` → service + method names. */
export function parseGrpcSymbol(symbol: string): {
  serviceName: string;
  methodName: string;
} {
  const slash = symbol.indexOf("/");
  if (slash === -1) {
    const dot = symbol.lastIndexOf(".");
    if (dot === -1) throw new Error(`Invalid gRPC symbol: ${symbol}`);
    return {
      serviceName: symbol.slice(0, dot),
      methodName: symbol.slice(dot + 1),
    };
  }
  return {
    serviceName: symbol.slice(0, slash),
    methodName: symbol.slice(slash + 1),
  };
}

/**
 * grpcurl-compatible address parsing.
 * TLS is the default (like grpcurl); only `grpc://` disables TLS without `# @grpc-plaintext`.
 */
export function parseGrpcAddress(address: string): {
  channelTarget: string;
  useTls: boolean;
} {
  const trimmed = address.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("grpcs://") || lower.startsWith("https://")) {
    return {
      channelTarget: trimmed.replace(/^(grpcs|https):\/\//i, ""),
      useTls: true,
    };
  }
  if (lower.startsWith("grpc://")) {
    return {
      channelTarget: trimmed.replace(/^grpc:\/\//i, ""),
      useTls: false,
    };
  }
  return { channelTarget: trimmed, useTls: true };
}
