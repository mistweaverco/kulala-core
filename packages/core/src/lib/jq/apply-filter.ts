import {
  buildRunnerResponseBody,
  primaryMediaType,
  type KulalaResponseFormatOptions,
} from "../runner/http-response-body";
import type { KulalaRequestSuccessResponse } from "../runner/types";
import { runJq } from "./run-jq";

export type ApplyJqFilterResult =
  | {
      ok: true;
      filteredBody: KulalaRequestSuccessResponse["body"];
    }
  | { ok: false; error: string };

function contentTypeForJqOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return "text/plain";
  try {
    JSON.parse(trimmed);
    return "application/json";
  } catch {
    return "text/plain";
  }
}

/**
 * Apply a jq filter to a raw response body and format the result.
 */
export async function applyJqFilter(
  rawBodyStr: string,
  filter: string,
  contentType: string,
  formatOpts?: KulalaResponseFormatOptions,
): Promise<ApplyJqFilterResult> {
  const jqResult = await runJq(rawBodyStr, filter);
  if (!jqResult.ok) return jqResult;

  const output = jqResult.output;
  const outputContentType =
    primaryMediaType(contentType) === "application/json" ||
    contentTypeForJqOutput(output) === "application/json"
      ? "application/json"
      : contentTypeForJqOutput(output);

  const filteredBody = await buildRunnerResponseBody(
    output,
    outputContentType,
    formatOpts,
  );
  return { ok: true, filteredBody };
}

export type EnrichResponseWithJqResult =
  | {
      ok: true;
      body: KulalaRequestSuccessResponse["body"];
      rawBody: string;
      filteredBody?: KulalaRequestSuccessResponse["body"];
    }
  | { ok: false; error: string };

/** Attach `rawBody` and optional formatted `filteredBody` to a runner response. */
export async function enrichResponseWithJq(
  rawBodyStr: string,
  contentType: string,
  body: KulalaRequestSuccessResponse["body"],
  jqFilter: string | undefined,
  formatOpts?: KulalaResponseFormatOptions,
): Promise<EnrichResponseWithJqResult> {
  if (!jqFilter?.trim()) {
    return { ok: true, body, rawBody: rawBodyStr };
  }

  const filtered = await applyJqFilter(
    rawBodyStr,
    jqFilter,
    contentType,
    formatOpts,
  );
  if (!filtered.ok) return filtered;

  return {
    ok: true,
    body,
    rawBody: rawBodyStr,
    filteredBody: filtered.filteredBody,
  };
}
