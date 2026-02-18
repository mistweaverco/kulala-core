import type { RequestHeaderType } from "./types";

export function getRequestHeaderType(headers: unknown): RequestHeaderType {
  if (typeof headers !== "object" || headers === null) {
    return "invalid";
  }
  const contentTypeHeader = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === "content-type",
  );
  if (!contentTypeHeader) {
    return "invalid";
  }
  const contentTypeValue = contentTypeHeader[1];
  if (typeof contentTypeValue === "string") {
    if (contentTypeValue.includes("application/json")) {
      return "json";
    }
    if (contentTypeValue.includes("multipart/form-data")) {
      return "form-data";
    }
    if (contentTypeValue.includes("application/x-www-form-urlencoded")) {
      return "form-urlencoded";
    }
  }
  return "invalid";
}

export function getJSONRequestBody(
  body: unknown,
): Record<string, unknown> | undefined {
  if (typeof body === "object" && body !== null) {
    return body as Record<string, unknown>;
  }
  return undefined;
}

export function getGraphQLRequestBody(
  body: unknown,
): { query: string; variables?: Record<string, unknown> } | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query: unknown }).query === "string"
  ) {
    const graphqlBody = body as {
      query: string;
      variables?: Record<string, unknown>;
    };
    return {
      query: graphqlBody.query,
      variables: graphqlBody.variables,
    };
  }
  return undefined;
}

/** Parse "key=value&key2=value2" into an object (application/x-www-form-urlencoded). */
export function parseFormUrlEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      out[decodeURIComponent(pair.trim())] = "";
    } else {
      out[decodeURIComponent(pair.slice(0, eq).trim())] = decodeURIComponent(
        pair
          .slice(eq + 1)
          .trim()
          .replace(/\+/g, " "),
      );
    }
  }
  return out;
}

export function getFormRequestBody(
  body: unknown,
  formType: "form-data" | "form-urlencoded",
): Record<string, unknown> | undefined {
  if (formType === "form-urlencoded") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  if (formType === "form-data") {
    if (typeof body === "object" && body !== null) {
      return body as Record<string, unknown>;
    }
    if (typeof body === "string") {
      return parseFormUrlEncoded(body) as Record<string, unknown>;
    }
    return undefined;
  }
  return undefined;
}

/** True if value looks like a file reference: { filePath: string, filename?: string }. */
export function isFileRef(
  value: unknown,
): value is { filePath: string; filename?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "filePath" in value &&
    typeof (value as { filePath: unknown }).filePath === "string"
  );
}

/**
 * Build FormData for multipart/form-data. Body entries can be strings or
 * file refs { filePath, filename? }. Paths are resolved relative to baseDir.
 */
export async function buildMultipartBody(
  body: Record<string, unknown>,
  baseDir: string,
): Promise<FormData> {
  const path = await import("path");
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (isFileRef(value)) {
      const resolvedPath = path.resolve(baseDir, value.filePath);
      const file = Bun.file(resolvedPath);
      form.append(
        key,
        file,
        value.filename ?? value.filePath.split(/[/\\]/).pop(),
      );
    } else {
      form.append(key, String(value ?? ""));
    }
  }
  return form;
}
