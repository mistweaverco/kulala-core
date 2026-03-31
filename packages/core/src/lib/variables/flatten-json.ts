/**
 * Flatten nested JSON into dotted path keys (JetBrains-style JSONPath in variables).
 * - client.host.url from { client: { host: { url: "example.org" } } }
 * - client.['host.url'] for keys that contain a dot: { client: { "host.url": "example.org" } }
 */

export function flattenToDotPaths(
  obj: unknown,
  prefix: string,
  out: Record<string, string>,
): void {
  if (obj === null || obj === undefined) return;
  if (
    typeof obj === "string" ||
    typeof obj === "number" ||
    typeof obj === "boolean"
  ) {
    out[prefix] = String(obj);
    return;
  }
  if (typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    const segment = /\./.test(k) ? `.['${k}']` : prefix ? "." + k : k;
    const nextPrefix = prefix ? prefix + segment : segment;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      out[nextPrefix] = String(v);
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      flattenToDotPaths(v, nextPrefix, out);
    }
  }
}
