import { readFile } from "fs/promises";
import { httpRequest } from "../runner/http-client";
import {
  isRemoteOpenAPISource,
  openAPICacheKeyFromSource,
  resolveOpenAPILocalPath,
} from "./host";
import { prepareOpenAPIDocument } from "./prepare-document";
import { buildOpenAPIIndex } from "./schema-index";
import type { OpenAPIIndex } from "./types";

export type LoadOpenAPISpecResult =
  | { ok: true; index: OpenAPIIndex; raw: string; cacheKey: string }
  | { ok: false; error: string };

export async function loadOpenAPISpecFromSource(
  source: string,
  startDir: string,
  options?: {
    headers?: Record<string, string>;
    method?: string;
    timeoutSec?: number;
    insecure?: boolean;
  },
): Promise<LoadOpenAPISpecResult> {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: "OpenAPI spec source is empty" };
  }

  const cacheKey = openAPICacheKeyFromSource(trimmed, startDir);

  try {
    let raw: string;
    let specSource: string;

    if (isRemoteOpenAPISource(trimmed)) {
      const headers = { ...(options?.headers ?? {}) };
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "accept")) {
        headers.Accept = "application/json, application/yaml, */*";
      }
      const res = await httpRequest({
        url: trimmed,
        method: options?.method ?? "GET",
        headers,
        timeoutSec: options?.timeoutSec ?? 120,
        insecure: options?.insecure,
      });
      raw = typeof res.body === "string" ? res.body : res.body.toString("utf8");
      specSource = trimmed;
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return {
          ok: false,
          error: `Failed to fetch OpenAPI spec (HTTP ${res.statusCode})`,
        };
      }
    } else {
      const path = resolveOpenAPILocalPath(trimmed, startDir);
      raw = await readFile(path, "utf-8");
      specSource = path;
    }

    const doc = prepareOpenAPIDocument(raw);
    if (!doc) {
      return { ok: false, error: "OpenAPI spec is not valid JSON or YAML" };
    }
    const index = buildOpenAPIIndex(doc, specSource);
    if (!index) {
      return { ok: false, error: "Document is not a recognized OpenAPI spec" };
    }
    return { ok: true, index, raw, cacheKey };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
