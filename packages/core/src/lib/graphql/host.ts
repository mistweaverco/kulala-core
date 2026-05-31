/** Normalize URL to a stable cache key (hostname + non-default port). */
export function graphqlSchemaHostFromUrl(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    const port =
      u.port ||
      (u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "");
    const isDefault =
      (u.protocol === "https:" && port === "443") ||
      (u.protocol === "http:" && port === "80");
    return isDefault ? host : `${host}:${port}`;
  } catch {
    return undefined;
  }
}
