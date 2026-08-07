import type { OpenAPIIndex } from "./types";
import { isRemoteOpenAPISource } from "./host";

/**
 * Resolve API base URL for operation requests.
 * Order: servers[0] → {{baseUrl}} env var → origin of remote spec URL.
 */
export function resolveOpenAPIBaseUrl(
  index: OpenAPIIndex,
  vars: Record<string, string>,
): string | undefined {
  if (index.servers.length > 0) {
    let server = index.servers[0]!.trim();
    if (server.endsWith("/")) server = server.slice(0, -1);
    for (const [k, v] of Object.entries(vars)) {
      server = server.replaceAll(`{{${k}}}`, v);
      server = server.replaceAll(`{${k}}`, v);
    }
    return server;
  }
  const baseUrl = vars.baseUrl?.trim();
  if (baseUrl) return baseUrl.replace(/\/$/, "");

  const source = index.specSource?.trim();
  if (source && isRemoteOpenAPISource(source)) {
    try {
      const u = new URL(source);
      return u.origin;
    } catch {
      // ignore
    }
  }
  return undefined;
}
