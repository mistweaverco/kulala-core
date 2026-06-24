import type {
  OAuth2Config,
  OAuth2RequestScope,
  OAuth2ScopedValue,
} from "./types";

/** PKCE methods as written in JetBrains http-client.env.json. */
export type OAuth2PkceConfigMethod = "Plain" | "SHA-256" | "S256";

/** PKCE methods used internally and on the wire (RFC 7636). */
export type OAuth2PkceWireMethod = "Plain" | "S256";

/**
 * Normalize PKCE challenge method from env config to an internal wire method.
 * JetBrains documents "SHA-256"; RFC 7636 and Kulala use "S256" on the wire.
 */
export function normalizePkceConfigMethod(
  method?: string,
): OAuth2PkceWireMethod {
  if (!method) return "S256";
  const normalized = method.trim().toLowerCase();
  if (normalized === "plain") return "Plain";
  if (
    normalized === "s256" ||
    normalized === "sha-256" ||
    normalized === "sha256"
  ) {
    return "S256";
  }
  return "S256";
}

/** RFC 7636 code_challenge_method query parameter value. */
export function pkceMethodQueryValue(method: OAuth2PkceWireMethod): string {
  return method === "Plain" ? "plain" : "S256";
}

function scopedValueMatches(
  value: OAuth2ScopedValue,
  scope: "In Token Request" | "In Auth Request",
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(" ");
  if (value.Use === scope || value.Use === "Everywhere") {
    const raw = value.Value;
    return Array.isArray(raw) ? raw.join(" ") : raw;
  }
  return undefined;
}

/**
 * Build HTTP headers from Custom Headers for a given OAuth request phase.
 * JetBrains supports plain string values (Everywhere) or { Value, Use } objects.
 */
export function buildOAuth2CustomHeaders(
  config: OAuth2Config,
  scope: "In Token Request" | "In Auth Request",
): Record<string, string> {
  const headers: Record<string, string> = {};
  const custom = config["Custom Headers"];
  if (!custom) return headers;

  for (const [name, value] of Object.entries(custom)) {
    const resolved = scopedValueMatches(value, scope);
    if (resolved !== undefined) {
      headers[name] = resolved;
    }
  }
  return headers;
}

/**
 * Apply Custom Request Parameters to URLSearchParams or a body param map.
 */
export function applyOAuth2CustomRequestParameters(
  config: OAuth2Config,
  scope: "In Token Request" | "In Auth Request",
  target: Record<string, string>,
): void {
  const custom = config["Custom Request Parameters"];
  if (!custom) return;

  for (const [key, value] of Object.entries(custom)) {
    const resolved = scopedValueMatches(value, scope);
    if (resolved !== undefined) {
      target[key] = resolved;
    }
  }
}

export type { OAuth2RequestScope, OAuth2ScopedValue };
