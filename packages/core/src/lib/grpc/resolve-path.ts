import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { substituteInString } from "../variables/substitute";

/** Resolve `{{ $env.VAR }}` placeholders in gRPC path values (JetBrains-style). */
function grpcPathEnvResolver(name: string): string | undefined {
  if (name.startsWith("$env.")) {
    return process.env[name.slice(5)];
  }
  return undefined;
}

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Resolve a gRPC proto/import path from an operator or inline flag value.
 * Expands {{variables}}, then ~, then joins relative paths to cwd.
 */
export function resolveGrpcPath(
  value: string,
  cwd: string,
  vars: Record<string, string> = {},
): string {
  const expanded = substituteInString(value.trim(), vars, grpcPathEnvResolver);
  const withHome = expandTilde(expanded);
  if (isAbsolute(withHome)) return withHome;
  return resolve(cwd, withHome);
}
