import { httpRequest } from "../runner/http-client";
import { GRAPHQL_INTROSPECTION_QUERY } from "./introspection-query";

export type GraphQLIntrospectionResult =
  | { ok: true; schema: Record<string, unknown> }
  | { ok: false; error: string };

export async function fetchGraphQLIntrospection(
  url: string,
  headers: Record<string, string> = {},
  options?: { timeoutSec?: number; insecure?: boolean },
): Promise<GraphQLIntrospectionResult> {
  const merged: Record<string, string> = { ...headers };
  const hasContentType = Object.keys(merged).some(
    (k) => k.toLowerCase() === "content-type",
  );
  if (!hasContentType) merged["Content-Type"] = "application/json";

  const body = JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY });

  try {
    const res = await httpRequest({
      url,
      method: "POST",
      headers: merged,
      body,
      timeoutSec: options?.timeoutSec ?? 120,
      insecure: options?.insecure,
    });
    const raw =
      typeof res.body === "string" ? res.body : res.body.toString("utf8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: `Introspection response is not JSON (HTTP ${res.statusCode})`,
      };
    }
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const msg =
        typeof (parsed.errors[0] as { message?: string })?.message === "string"
          ? (parsed.errors[0] as { message: string }).message
          : "GraphQL introspection failed";
      return { ok: false, error: msg };
    }
    if (
      !parsed.data ||
      typeof parsed.data !== "object" ||
      !("__schema" in (parsed.data as object))
    ) {
      return {
        ok: false,
        error: `Invalid introspection response (HTTP ${res.statusCode})`,
      };
    }
    return { ok: true, schema: parsed };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
