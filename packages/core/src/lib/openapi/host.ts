import { isAbsolute, normalize, resolve } from "path";
import { graphqlSchemaHostFromUrl } from "../graphql/host";

/** True when the resolved source should be fetched over HTTP(S). */
export function isRemoteOpenAPISource(source: string): boolean {
  const s = source.trim();
  return /^https?:\/\//i.test(s) || /^wss?:\/\//i.test(s);
}

/** Resolve a local filesystem path relative to the HTTP file directory. */
export function resolveOpenAPILocalPath(
  source: string,
  startDir: string,
): string {
  const trimmed = source.trim();
  if (trimmed.startsWith("file://")) {
    try {
      return normalize(new URL(trimmed).pathname);
    } catch {
      return normalize(resolve(startDir, trimmed.replace(/^file:\/\//, "")));
    }
  }
  if (isAbsolute(trimmed)) return normalize(trimmed);
  return normalize(resolve(startDir, trimmed));
}

/**
 * Stable cache key for an OpenAPI spec source.
 * Remote: hostname (+ port). Local: normalized absolute path.
 */
export function openAPICacheKeyFromSource(
  source: string,
  startDir: string,
): string {
  const trimmed = source.trim();
  if (isRemoteOpenAPISource(trimmed)) {
    const host = graphqlSchemaHostFromUrl(trimmed);
    return host ?? trimmed;
  }
  return resolveOpenAPILocalPath(trimmed, startDir);
}
