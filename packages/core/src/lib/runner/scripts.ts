import path from "path";
import type { KulalaBlock } from "./../parser/types/block";
import type {
  KulalaScriptConsoleLine,
  KulalaScriptConsoleOrigin,
  RunnerResponseLike,
} from "./types";
import {
  type KulalaScript,
  type KulalaScriptType,
} from "./../parser/types/script";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { createRequire } from "node:module";
import {
  deleteVariable,
  getVariable,
  getVariables,
  setVariable,
} from "../persistence";
import {
  parseStoredVariable,
  removeVariableFromMaps,
  writeVariableToMaps,
} from "../variables/variable-lookup";
import {
  exec,
  execFile,
  execFileSync,
  execSync,
  spawn,
  spawnSync,
} from "node:child_process";
import { inspect } from "node:util";
import type { Lua } from "wasmoon-lua5.1";

import type { KulalaGrpcFlag } from "../grpc/types";
import {
  buildScriptCookies,
  buildScriptRequestApi,
  buildScriptRequestContextFromBlock,
  type ScriptRequestContext,
} from "./script-request-context";
import { buildKulalaScriptApi } from "./kulala-script-api";
import { ScriptPromptError } from "./script-prompt-error";
import { ScriptReplayError, ScriptSkipError } from "./script-control-error";

export type ScriptRunScope = {
  /** Stable document id for request-scoped variables and prompts. */
  stableDocId: string;
};

export type ScriptFlowContext = {
  /** "Execution flow" local headers (not persisted). */
  globalHeaders: Record<string, string>;
  /** `# @grpc-*` from KULALA_SHARED blocks in the document. */
  sharedGrpcFlags?: KulalaGrpcFlag[];
  /** `### KULALA_SHARED` / `### KULALA_SHARED_EACH` blocks (scripts run around each request). */
  sharedBlocks?: KulalaBlock[];
  /** Shared block HTTP requests already executed (`KULALA_SHARED` runs once per document run). */
  sharedHttpExecuted?: Set<string>;
  /** HTTP results from shared blocks in the current request, flushed by runDocument. */
  collectedSharedHttpResults?: Record<string, unknown>[];
  /** In-memory prior responses for {{BLOCK.response}} during a document run. */
  requestVarResults?: Map<
    string,
    import("../variables/request-vars").PreviousResponse
  >;
};

type ScriptHeaders = {
  valueOf: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
  valuesOf: (name: string) => string[];
};

/** Mirrors JetBrains ContentType (Content-Type header). */
export type ScriptContentType = {
  mimeType: string;
  charset: string;
};

type ScriptResponse = {
  status: number;
  headers: ScriptHeaders;
  /**
   * JetBrains HTTP Client: string for plain text, or parsed JSON value (object, array, etc.)
   * when the response is JSON. See https://www.jetbrains.com/help/idea/http-response-reference.html
   */
  body: string | unknown;
  contentType: ScriptContentType;
  cookies: () => import("./script-request-context").ScriptCookie[];
  cookiesByName: (
    name: string,
  ) => import("./script-request-context").ScriptCookie[];
};

/** JetBrains HTTP Client request object (shape varies by script phase). */
export type ScriptRequest = ReturnType<typeof buildScriptRequestApi>;

type ScriptClient = {
  test: (testName: string, func: () => unknown) => void;
  assert: (condition: unknown, message?: string) => void;
  exit: () => never;
  global: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => unknown;
    isEmpty: () => boolean;
    clear: (name: string) => boolean;
    clearAll: () => void;
    delete: (name: string) => boolean; // alias for clear (legacy)
    headers: {
      set: (headerName: string, headerValue: string) => void;
      clear: (headerName: string) => void;
    };
  };
  log: (...args: unknown[]) => void;
};

function formatScriptConsoleArgs(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string"
        ? a
        : inspect(a, { colors: false, depth: 8, breakLength: 120 }),
    )
    .join(" ");
}

function makeHeaders(
  headers: Record<string, string> | undefined,
): ScriptHeaders {
  const lc: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) lc[k.toLowerCase()] = v;
  const get = (name: string) => lc[name.toLowerCase()];
  const valuesOf = (name: string) => {
    const v = get(name);
    if (v === undefined || v === "") return [];
    return v.includes("\n")
      ? v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [v];
  };
  return { get, valueOf: get, valuesOf };
}

function parseContentTypeHeader(header: string | undefined): ScriptContentType {
  if (!header || !header.trim()) return { mimeType: "", charset: "" };
  const main = header.split(";")[0]?.trim() ?? "";
  const mimeType = main || "";
  const m = header.match(/charset\s*=\s*([^;]+)/i);
  const raw = m?.[1]?.trim() ?? "";
  const charset = raw.replace(/^["']|["']$/g, "");
  return { mimeType, charset };
}

function isLikelyJsonContentType(ct: string): boolean {
  const c = ct.toLowerCase();
  return c.includes("json") || c.includes("+json");
}

function resolveScriptBody(
  text: string,
  contentTypeHeader: string | undefined,
): string | unknown {
  const ct = contentTypeHeader ?? "";
  const tryParse = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  if (isLikelyJsonContentType(ct) && text.trim().length > 0) {
    const parsed = tryParse();
    if (parsed !== undefined) return parsed;
    return text;
  }
  const t = text.trim();
  if (
    (t.startsWith("{") && t.endsWith("}")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    const parsed = tryParse();
    if (parsed !== undefined) return parsed;
  }
  return text;
}

type ParsedTempCallsite = { tempLine: number; column: number };

/** Parse Bun-style stack `(path/to/file.tsx:LINE:COL)` targeting the Kulala script temp module. */
function parseCallsiteFromStack(
  stack: string | undefined,
  tempAbsPath: string,
): ParsedTempCallsite | undefined {
  if (!stack) return undefined;
  const resolvedTarget = path.resolve(tempAbsPath);
  const basename = path.basename(resolvedTarget);
  for (const frame of stack.split("\n")) {
    const open = frame.lastIndexOf("(");
    const close = frame.lastIndexOf(")");
    if (open === -1 || close <= open) continue;
    const spec = frame.slice(open + 1, close);
    const lastColon = spec.lastIndexOf(":");
    const prevColon = spec.lastIndexOf(":", lastColon - 1);
    if (
      lastColon === -1 ||
      prevColon === -1 ||
      prevColon <= 0 ||
      lastColon <= prevColon
    )
      continue;
    const file = spec.slice(0, prevColon);
    const ln = Number(spec.slice(prevColon + 1, lastColon));
    const col = Number(spec.slice(lastColon + 1));
    if (
      file.length === 0 ||
      !Number.isFinite(ln) ||
      !Number.isFinite(col) ||
      ln < 1 ||
      col < 1
    )
      continue;
    try {
      const resolved = path.resolve(file);
      if (resolved !== resolvedTarget && path.basename(file) !== basename)
        continue;
    } catch {
      continue;
    }
    return { tempLine: ln, column: col };
  }
  return undefined;
}

function buildConsoleOrigin(args: {
  script: KulalaScript;
  block: KulalaBlock;
  phase: KulalaScriptType;
  httpDocumentPath?: string;
  tempCallsite?: ParsedTempCallsite | undefined;
}): KulalaScriptConsoleOrigin {
  const { script, block, phase, httpDocumentPath, tempCallsite } = args;
  const httpDirectiveLine =
    (block.contentStartLine ?? block.position.start) + script.lineNumber;
  let originFile: string;
  if (script.source === "inline") {
    const fp = script.filepath?.trim() ?? "";
    originFile =
      fp.length > 0
        ? path.isAbsolute(fp)
          ? path.resolve(fp)
          : path.resolve(
              path.dirname(
                httpDocumentPath && httpDocumentPath.length > 0
                  ? httpDocumentPath
                  : process.cwd(),
              ),
              fp,
            )
        : path.resolve(httpDocumentPath ?? process.cwd());
  } else {
    originFile = path.resolve(process.cwd(), script.filepath ?? "");
  }

  const origin: KulalaScriptConsoleOrigin = {
    phase,
    source: script.source,
    file: originFile,
    httpDirectiveLine,
  };

  if (!tempCallsite || tempCallsite.tempLine < 2) return origin;

  const userBodyLine = tempCallsite.tempLine - 1;
  if (script.source === "inline") {
    origin.line = httpDirectiveLine + userBodyLine;
  } else {
    origin.line = userBodyLine;
  }
  origin.column = tempCallsite.column;
  return origin;
}

function makeResponseForScripts(
  response?: RunnerResponseLike,
  responseUrl?: string,
): ScriptResponse {
  if (!response) {
    return {
      status: 0,
      headers: makeHeaders({}),
      body: "",
      contentType: { mimeType: "", charset: "" },
      cookies: () => [],
      cookiesByName: () => [],
    };
  }
  const bodyRaw = response.body;
  const text = typeof bodyRaw === "string" ? bodyRaw : String(bodyRaw ?? "");
  const ctHeader = response.headers["content-type"];
  const body = resolveScriptBody(text, ctHeader);
  const urlForCookies = responseUrl ?? "";
  const allCookies = () =>
    urlForCookies ? buildScriptCookies(response.headers, urlForCookies) : [];
  return {
    status: response.statusCode,
    headers: makeHeaders(response.headers),
    body,
    contentType: parseContentTypeHeader(ctHeader),
    cookies: allCookies,
    cookiesByName: (name: string) =>
      allCookies().filter((c) => c.name === name),
  };
}

class ScriptExitError extends Error {
  override name = "ScriptExitError";
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function setHeaderCaseInsensitive(
  map: Record<string, string>,
  name: string,
  value: string | null,
): void {
  const targetLc = normalizeHeaderName(name);
  for (const k of Object.keys(map)) {
    if (normalizeHeaderName(k) === targetLc) delete map[k];
  }
  if (value !== null) {
    map[name] = value;
  }
}

const getTempName = (): string => {
  const osTempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const timestamp = Date.now();
  const uuid = crypto.randomUUID();
  return path.join(osTempDir, `kulala_script_${timestamp}_${uuid}.js`);
};

// Bun.Transpiler must be constructed with the target loader: passing `{ loader: "ts" }`
// only to transformSync() is ignored (input is parsed as JS/JSX, so `const x: string` fails).
const jsTranspiler = new Bun.Transpiler({ loader: "js" });
const tsTranspiler = new Bun.Transpiler({ loader: "ts" });
const tsxTranspiler = new Bun.Transpiler({ loader: "tsx" });

const wrapScriptContent = (
  content: string,
  loader: "js" | "jsx" | "ts" | "tsx" = "js",
): string => {
  // Default export must be awaited: a fire-and-forget `(async()=>{...})()` completes
  // module evaluation before `await` boundaries, so `finally` clears global `request`
  // while the script is still running (breaks substitution and can throw).
  const transpiler =
    loader === "tsx"
      ? tsxTranspiler
      : loader === "ts"
        ? tsTranspiler
        : loader === "jsx"
          ? tsxTranspiler
          : jsTranspiler;
  return transpiler.transformSync(
    `export default async function kulalaWrappedScript() {\n${content}\n}`,
  );
};

async function executeJsTsScript(
  modulePath: string,
  ctx: {
    client: ScriptClient;
    request: ScriptRequest;
    response: ScriptResponse;
    kulala: ReturnType<typeof buildKulalaScriptApi>;
    /** When set, `console.*` is captured via this hook (caller supplies origin). */
    pushCapturedConsole?: (
      level: KulalaScriptConsoleLine["level"],
      args: unknown[],
    ) => void;
  },
): Promise<void> {
  const prev = {
    client: (globalThis as Record<string, unknown>).client,
    request: (globalThis as Record<string, unknown>).request,
    response: (globalThis as Record<string, unknown>).response,
    $kulala: (globalThis as Record<string, unknown>).$kulala,
    require: (globalThis as Record<string, unknown>).require,
    exec: (globalThis as Record<string, unknown>).exec,
    execFile: (globalThis as Record<string, unknown>).execFile,
    execSync: (globalThis as Record<string, unknown>).execSync,
    execFileSync: (globalThis as Record<string, unknown>).execFileSync,
    spawn: (globalThis as Record<string, unknown>).spawn,
    spawnSync: (globalThis as Record<string, unknown>).spawnSync,
    atob: (globalThis as Record<string, unknown>).atob,
    btoa: (globalThis as Record<string, unknown>).btoa,
    sleep: (globalThis as Record<string, unknown>).sleep,
  };

  const pushCap = ctx.pushCapturedConsole;
  const prevConsole =
    pushCap !== undefined
      ? {
          log: console.log.bind(console),
          error: console.error.bind(console),
          warn: console.warn.bind(console),
          info: console.info.bind(console),
          debug: console.debug.bind(console),
        }
      : undefined;

  try {
    (globalThis as unknown as Record<string, unknown>).client = ctx.client;
    (globalThis as unknown as Record<string, unknown>).request = ctx.request;
    (globalThis as unknown as Record<string, unknown>).response = ctx.response;
    (globalThis as unknown as Record<string, unknown>).$kulala = ctx.kulala;

    // Allow CommonJS requires in scripts.
    const req = createRequire(modulePath);
    (globalThis as unknown as Record<string, unknown>).require = req;

    // JetBrains parity: expose common child_process helpers as globals.
    (globalThis as unknown as Record<string, unknown>).exec = exec;
    (globalThis as unknown as Record<string, unknown>).execFile = execFile;
    (globalThis as unknown as Record<string, unknown>).execSync = execSync;
    (globalThis as unknown as Record<string, unknown>).execFileSync =
      execFileSync;
    (globalThis as unknown as Record<string, unknown>).spawn = spawn;
    (globalThis as unknown as Record<string, unknown>).spawnSync = spawnSync;

    // JetBrains parity: atob/btoa.
    if (
      typeof (globalThis as unknown as { atob?: unknown }).atob !== "function"
    ) {
      (globalThis as unknown as Record<string, unknown>).atob = (
        data: string,
      ) => Buffer.from(data, "base64").toString("binary");
    }
    if (
      typeof (globalThis as unknown as { btoa?: unknown }).btoa !== "function"
    ) {
      (globalThis as unknown as Record<string, unknown>).btoa = (
        data: string,
      ) => Buffer.from(data, "binary").toString("base64");
    }

    // JetBrains parity: sleep(ms) helper.
    if (
      typeof (globalThis as unknown as { sleep?: unknown }).sleep !== "function"
    ) {
      (globalThis as unknown as Record<string, unknown>).sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
    }

    if (pushCap && prevConsole) {
      console.log = (...args: unknown[]) => {
        pushCap("log", args);
      };
      console.error = (...args: unknown[]) => {
        pushCap("error", args);
      };
      console.warn = (...args: unknown[]) => {
        pushCap("warn", args);
      };
      console.info = (...args: unknown[]) => {
        pushCap("info", args);
      };
      console.debug = (...args: unknown[]) => {
        pushCap("debug", args);
      };
    }

    const mod = (await import(modulePath)) as { default?: unknown };
    const run = mod.default;
    if (typeof run === "function") {
      await (run as () => unknown)();
    }
  } finally {
    (globalThis as unknown as Record<string, unknown>).client = prev.client;
    (globalThis as unknown as Record<string, unknown>).request = prev.request;
    (globalThis as unknown as Record<string, unknown>).response = prev.response;
    (globalThis as unknown as Record<string, unknown>).$kulala = prev.$kulala;
    (globalThis as unknown as Record<string, unknown>).require = prev.require;
    (globalThis as unknown as Record<string, unknown>).exec = prev.exec;
    (globalThis as unknown as Record<string, unknown>).execFile = prev.execFile;
    (globalThis as unknown as Record<string, unknown>).execSync = prev.execSync;
    (globalThis as unknown as Record<string, unknown>).execFileSync =
      prev.execFileSync;
    (globalThis as unknown as Record<string, unknown>).spawn = prev.spawn;
    (globalThis as unknown as Record<string, unknown>).spawnSync =
      prev.spawnSync;
    (globalThis as unknown as Record<string, unknown>).atob = prev.atob;
    (globalThis as unknown as Record<string, unknown>).btoa = prev.btoa;
    (globalThis as unknown as Record<string, unknown>).sleep = prev.sleep;
    if (prevConsole) {
      console.log = prevConsole.log;
      console.error = prevConsole.error;
      console.warn = prevConsole.warn;
      console.info = prevConsole.info;
      console.debug = prevConsole.debug;
    }
  }
}

async function executeLuaScript(
  content: string,
  ctx: {
    client: ScriptClient;
    request: ScriptRequest;
    response: ScriptResponse;
  },
): Promise<void> {
  const mod = await import("wasmoon-lua5.1");
  const LuaCtor =
    (mod as unknown as { Lua?: unknown }).Lua ??
    (mod as unknown as { default?: { Lua?: unknown } }).default?.Lua ??
    undefined;
  if (
    !LuaCtor ||
    typeof (LuaCtor as { create?: unknown }).create !== "function"
  ) {
    throw new Error("Lua runtime is unavailable (Lua.create export not found)");
  }
  const lua = await (LuaCtor as { create: () => Promise<Lua> }).create();
  const luaCtx = lua.ctx as { [k: string]: unknown };

  // Bridge: mirror the JS shape closely.
  luaCtx.client = {
    log: (...args: unknown[]) => ctx.client.log(...args),
    test: (name: string, func: unknown) => {
      // Lua cannot pass JS functions; keep API present for parity.
      void name;
      void func;
      throw new Error("client.test is not supported in Lua scripts");
    },
    assert: (cond: unknown, msg?: string) => ctx.client.assert(cond, msg),
    exit: () => ctx.client.exit(),
    global: {
      set: (k: string, v: unknown) => ctx.client.global.set(k, v),
      get: (k: string) => ctx.client.global.get(k),
      isEmpty: () => ctx.client.global.isEmpty(),
      clear: (k: string) => ctx.client.global.clear(k),
      clearAll: () => ctx.client.global.clearAll(),
      delete: (k: string) => ctx.client.global.delete(k),
      headers: {
        set: (k: string, v: string) => ctx.client.global.headers.set(k, v),
        clear: (k: string) => ctx.client.global.headers.clear(k),
      },
    },
  };
  const req = ctx.request;
  const luaBody =
    typeof req.body === "function"
      ? () => (req.body as () => string | undefined)()
      : {
          getRaw: () =>
            (req.body as { getRaw: () => string | undefined }).getRaw(),
          tryGetSubstituted: () =>
            (
              req.body as {
                tryGetSubstituted: () => string | undefined;
              }
            ).tryGetSubstituted(),
        };
  const luaUrl =
    typeof req.url === "function"
      ? () => (req.url as () => string)()
      : {
          getRaw: () => (req.url as { getRaw: () => string }).getRaw(),
          tryGetSubstituted: () =>
            (
              req.url as { tryGetSubstituted: () => string }
            ).tryGetSubstituted(),
        };
  luaCtx.request = {
    variables: {
      set: (k: string, v: unknown) => req.variables.set(k, v),
      get: (k: string) => req.variables.get(k),
      all: () => req.variables.all(),
    },
    environment: {
      get: (k: string) => req.environment.get(k),
    },
    method: req.method,
    iteration: () => req.iteration(),
    body: luaBody,
    url: luaUrl,
    headers: {
      all: () => req.headers.all(),
      findByName: (name: string) => req.headers.findByName(name),
    },
  };
  luaCtx.response = {
    status: ctx.response.status,
    headers: {
      get: (name: string) => ctx.response.headers.get(name),
      valueOf: (name: string) => ctx.response.headers.valueOf(name),
      valuesOf: (name: string) => ctx.response.headers.valuesOf(name),
    },
    body: ctx.response.body,
    contentType: ctx.response.contentType,
    cookies: () => ctx.response.cookies(),
    cookiesByName: (name: string) => ctx.response.cookiesByName(name),
  };

  // Basic assert/test helpers (useful for parity and future scripting tests).
  luaCtx.assert = {
    ok: (cond: unknown, msg?: string) => {
      if (!cond) throw new Error(msg ?? "assert.ok failed");
      return true;
    },
    equal: (a: unknown, b: unknown, msg?: string) => {
      if (a !== b) throw new Error(msg ?? `assert.equal failed: ${a} !== ${b}`);
      return true;
    },
  };

  try {
    await lua.doString(content);
  } finally {
    lua.global.close();
  }
}

export const runScripts = async (
  scripts: KulalaScript[],
  type: KulalaScriptType,
  block: KulalaBlock,
  filePath?: string,
  response?: RunnerResponseLike,
  vars?: Record<string, string>,
  flow?: ScriptFlowContext,
  scriptConsole?: KulalaScriptConsoleLine[],
  requestContext?: ScriptRequestContext,
  scope?: ScriptRunScope,
): Promise<void> => {
  const mutableVars = vars ?? {};
  for (const script of scripts) {
    const tmpName = path.resolve(getTempName());
    const cwd = path.resolve(process.cwd());
    const tempCwd = path.resolve(path.dirname(filePath || tmpName));

    const emitConsoleLine = (
      level: KulalaScriptConsoleLine["level"],
      message: string,
      tempCallsite?: ParsedTempCallsite,
    ) => {
      if (scriptConsole) {
        scriptConsole.push({
          level,
          message,
          origin: buildConsoleOrigin({
            script,
            block,
            phase: type,
            httpDocumentPath: filePath,
            tempCallsite,
          }),
        });
      } else if (level === "error") {
        console.error(message);
      } else {
        console.log(message);
      }
    };

    const captureJsCallsite = (): ParsedTempCallsite | undefined =>
      script.lang !== "lua"
        ? parseCallsiteFromStack(new Error().stack, tmpName)
        : undefined;

    try {
      process.chdir(tempCwd);

      const scriptReqCtx =
        requestContext ??
        buildScriptRequestContextFromBlock({
          block,
          phase: type,
          effectiveBody: block.request.body,
          env: "default",
          startDir: tempCwd,
          mutableVars,
          iteration: 0,
        });
      const requestObj: ScriptRequest = buildScriptRequestApi(scriptReqCtx);

      const clientObj: ScriptClient = {
        test: (testName: string, func: () => unknown) => {
          if (typeof testName !== "string" || testName.trim().length === 0) {
            throw new Error("client.test: testName must be a non-empty string");
          }
          if (typeof func !== "function") {
            throw new Error("client.test: func must be a function");
          }
          try {
            func();
            emitConsoleLine("log", `✓ ${testName}`, captureJsCallsite());
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            emitConsoleLine(
              "error",
              `✗ ${testName}: ${msg}`,
              captureJsCallsite(),
            );
            throw e;
          }
        },
        assert: (condition: unknown, message?: string) => {
          if (!condition) {
            throw new Error(message ?? "client.assert failed");
          }
        },
        exit: () => {
          throw new ScriptExitError("client.exit");
        },
        global: {
          set: (name: string, value: unknown) => {
            setVariable("global", name, value as Record<string, unknown>);
            writeVariableToMaps(name, value, mutableVars);
          },
          get: (name: string) => {
            const v = getVariable("global", name);
            if (v !== undefined) return v;
            return parseStoredVariable(mutableVars[name]);
          },
          isEmpty: () => Object.keys(getVariables("global")).length === 0,
          clear: (name: string) => {
            removeVariableFromMaps(name, mutableVars);
            return deleteVariable("global", name);
          },
          clearAll: () => {
            const vars = getVariables("global");
            for (const k of Object.keys(vars)) {
              removeVariableFromMaps(k, mutableVars);
              deleteVariable("global", k);
            }
          },
          delete: (name: string) => deleteVariable("global", name),
          headers: {
            set: (headerName: string, headerValue: string) => {
              if (!flow) return;
              setHeaderCaseInsensitive(
                flow.globalHeaders,
                headerName,
                String(headerValue),
              );
            },
            clear: (headerName: string) => {
              if (!flow) return;
              setHeaderCaseInsensitive(flow.globalHeaders, headerName, null);
            },
          },
        },
        log: (...args: unknown[]) => {
          emitConsoleLine(
            "log",
            formatScriptConsoleArgs(args),
            captureJsCallsite(),
          );
        },
      };

      const responseObj = makeResponseForScripts(
        response,
        requestContext?.responseUrl,
      );

      const stableDocId = scope?.stableDocId ?? filePath ?? "";
      const kulalaApi = buildKulalaScriptApi({
        stableDocId,
        blockName: block.name,
        mutableVars,
        phase: type,
      });

      if (script.lang === "lua") {
        await executeLuaScript(script.content, {
          client: clientObj,
          request: requestObj,
          response: responseObj,
        });
      } else {
        const loader = script.lang === "ts" ? "ts" : "js";
        writeFileSync(
          tmpName,
          wrapScriptContent(script.content, loader),
          "utf-8",
        );
        await executeJsTsScript(tmpName, {
          client: clientObj,
          request: requestObj,
          response: responseObj,
          kulala: kulalaApi,
          pushCapturedConsole:
            scriptConsole !== undefined
              ? (level, args) => {
                  emitConsoleLine(
                    level,
                    formatScriptConsoleArgs(args),
                    parseCallsiteFromStack(new Error().stack, tmpName),
                  );
                }
              : undefined,
        });
      }
    } catch (error) {
      if (error instanceof ScriptExitError) {
        break;
      }
      if (
        error instanceof ScriptPromptError ||
        error instanceof ScriptSkipError ||
        error instanceof ScriptReplayError
      ) {
        throw error;
      }
      emitConsoleLine(
        "error",
        `Error executing script: ${
          error instanceof Error ? error.message : String(error)
        }`,
        captureJsCallsite(),
      );
      // JetBrains: pre-request script errors abort the request; post-request errors
      // propagate after HTTP has completed (handled in doRequestFromBlock).
      throw error;
    } finally {
      try {
        process.chdir(cwd);
      } catch {
        // ignore chdir restore failure
      }
      if (existsSync(tmpName)) {
        unlinkSync(tmpName);
      }
    }
  }
};
