import type { KulalaBlock } from "../parser/types/block";
import { loadEnvVars } from "../variables/env-files";
import { substituteInString } from "../variables/substitute";
import {
  parseStoredVariable,
  writeVariableToMaps,
} from "../variables/variable-lookup";
import type { VariableResolver } from "./types";
import { buildHeadersFromSection } from "./headers";
import { normalizeSetCookieFromLine } from "../persistence/cookie-store";
import {
  type CollectionIterationPlan,
  templateValueAtIndex,
} from "./collection-iteration";

/** Cookie object exposed to scripts (JetBrains response.cookies). */
export type ScriptCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expires?: string;
};

export type ScriptRequestContext = {
  phase: "preRequest" | "postRequest";
  method: string;
  /** URL as written in the file (may contain {{vars}}). */
  urlRaw: string;
  /** Headers from the block before substitution. */
  headersRaw: Record<string, string>;
  /** Effective body before substitution (file refs resolved). */
  bodyRaw: unknown;
  /** Substituted URL (pre-request tryGetSubstituted). */
  urlSubstituted?: string;
  /** Request body as sent (post-request). */
  bodySent?: string;
  /** Request URL as sent (post-request). */
  urlSent?: string;
  /** Request headers as sent (post-request). */
  headersSent?: Record<string, string>;
  env: string;
  startDir: string;
  resolver?: VariableResolver;
  mutableVars: Record<string, string>;
  /** JetBrains: 0-based index in a collection loop (0 = first request). */
  iteration: number;
  /** Active collection loop (when count > 1). */
  collectionPlan?: CollectionIterationPlan;
  /** Response URL for parsing Set-Cookie (post-request). */
  responseUrl?: string;
  /** Response headers for cookies (post-request). */
  responseHeaders?: Record<string, string>;
};

function serializeBodyRaw(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (typeof body === "object") return JSON.stringify(body);
  return String(body);
}

function substituteBody(
  body: unknown,
  vars: Record<string, string>,
  resolver?: VariableResolver,
): string | undefined {
  const raw = serializeBodyRaw(body);
  if (raw === undefined) return undefined;
  return substituteInString(raw, vars, resolver);
}

export function buildScriptCookies(
  headers: Record<string, string> | undefined,
  responseUrl: string,
): ScriptCookie[] {
  const raw = headers?.["set-cookie"];
  if (!raw) return [];
  const lines = raw.includes("\n")
    ? raw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
    : [raw];
  const out: ScriptCookie[] = [];
  for (const line of lines) {
    const n = normalizeSetCookieFromLine(line, responseUrl);
    if (!n) continue;
    out.push({
      name: n.name,
      value: n.value,
      domain: n.domain,
      path: n.path,
      secure: n.secure,
      ...(n.expiresAt ? { expires: n.expiresAt } : {}),
    });
  }
  return out;
}

type PreRequestHeader = {
  name: () => string;
  getRawValue: () => string;
  tryGetSubstituted: () => string;
};

type PostRequestHeader = {
  name: () => string;
  value: () => string;
};

function makePreRequestHeader(
  name: string,
  rawValue: string,
  vars: Record<string, string>,
  resolver?: VariableResolver,
): PreRequestHeader {
  return {
    name: () => name,
    getRawValue: () => rawValue,
    tryGetSubstituted: () => substituteInString(rawValue, vars, resolver),
  };
}

function makePostRequestHeader(name: string, value: string): PostRequestHeader {
  return {
    name: () => name,
    value: () => value,
  };
}

export function buildScriptRequestApi(ctx: ScriptRequestContext) {
  const envVars = loadEnvVars(ctx.env, ctx.startDir);

  const variables = {
    set: (name: string, value: unknown) => {
      if (ctx.phase === "postRequest") {
        throw new Error(
          "request.variables.set is not available in post-request scripts",
        );
      }
      writeVariableToMaps(name, value, ctx.mutableVars);
    },
    get: (name: string) => parseStoredVariable(ctx.mutableVars[name]),
    all: () => ({ ...ctx.mutableVars }),
  };

  const environment = {
    get: (name: string): string | null => {
      const v = envVars[name];
      return v === undefined ? null : v;
    },
  };

  const iteration = () => ctx.iteration;

  const templateValue = (index: number): unknown => {
    if (!ctx.collectionPlan || ctx.collectionPlan.count <= 1) {
      return undefined;
    }
    return templateValueAtIndex(ctx.collectionPlan, index);
  };

  if (ctx.phase === "preRequest") {
    const headerEntries = Object.entries(ctx.headersRaw).map(([name, value]) =>
      makePreRequestHeader(name, value, ctx.mutableVars, ctx.resolver),
    );
    const findByName = (headerName: string): PreRequestHeader | undefined => {
      const lc = headerName.toLowerCase();
      const entry = Object.entries(ctx.headersRaw).find(
        ([k]) => k.toLowerCase() === lc,
      );
      if (!entry) return undefined;
      return makePreRequestHeader(
        entry[0],
        entry[1],
        ctx.mutableVars,
        ctx.resolver,
      );
    };

    return {
      variables,
      environment,
      method: ctx.method,
      iteration,
      templateValue,
      headers: {
        all: () => headerEntries,
        findByName,
      },
      body: {
        getRaw: () => serializeBodyRaw(ctx.bodyRaw),
        tryGetSubstituted: () =>
          substituteBody(ctx.bodyRaw, ctx.mutableVars, ctx.resolver),
      },
      url: {
        getRaw: () => ctx.urlRaw,
        tryGetSubstituted: () =>
          ctx.urlSubstituted ??
          substituteInString(ctx.urlRaw, ctx.mutableVars, ctx.resolver),
      },
    };
  }

  const sentHeaders = ctx.headersSent ?? {};
  const postHeaderEntries = Object.entries(sentHeaders).map(([name, value]) =>
    makePostRequestHeader(name, value),
  );

  return {
    variables,
    environment,
    method: ctx.method,
    iteration,
    templateValue,
    headers: {
      all: () => postHeaderEntries,
      findByName: (headerName: string): PostRequestHeader | undefined => {
        const lc = headerName.toLowerCase();
        const entry = Object.entries(sentHeaders).find(
          ([k]) => k.toLowerCase() === lc,
        );
        if (!entry) return undefined;
        return makePostRequestHeader(entry[0], entry[1]);
      },
    },
    body: () => ctx.bodySent,
    url: () => ctx.urlSent ?? "",
  };
}

export function buildScriptRequestContextFromBlock(args: {
  block: KulalaBlock;
  phase: "preRequest" | "postRequest";
  effectiveBody: unknown;
  env: string;
  startDir: string;
  mutableVars: Record<string, string>;
  resolver?: VariableResolver;
  iteration: number;
  collectionPlan?: CollectionIterationPlan;
  urlSubstituted?: string;
  urlSent?: string;
  headersSent?: Record<string, string>;
  bodySent?: string;
  responseUrl?: string;
  responseHeaders?: Record<string, string>;
}): ScriptRequestContext {
  const urlRaw =
    typeof args.block.request.url === "string" ? args.block.request.url : "";
  return {
    phase: args.phase,
    method: args.block.request.method || "GET",
    urlRaw,
    headersRaw: buildHeadersFromSection(args.block.request.headerSection),
    bodyRaw: args.effectiveBody,
    urlSubstituted: args.urlSubstituted,
    urlSent: args.urlSent,
    headersSent: args.headersSent,
    bodySent: args.bodySent,
    env: args.env,
    startDir: args.startDir,
    resolver: args.resolver,
    mutableVars: args.mutableVars,
    iteration: args.iteration,
    collectionPlan: args.collectionPlan,
    responseUrl: args.responseUrl,
    responseHeaders: args.responseHeaders,
  };
}

export function bodyPayloadToScriptString(
  bodyPayload: string | Buffer | FormData | undefined,
): string | undefined {
  if (bodyPayload == null) return undefined;
  if (typeof bodyPayload === "string") return bodyPayload;
  if (Buffer.isBuffer(bodyPayload)) return bodyPayload.toString("utf-8");
  return "[multipart/form-data]";
}
