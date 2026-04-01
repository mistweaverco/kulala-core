import path from "path";
import type { KulalaBlock } from "./../parser/types/block";
import type { RunnerResponseLike } from "./types";
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
  exec,
  execFile,
  execFileSync,
  execSync,
  spawn,
  spawnSync,
} from "node:child_process";
import type { Lua } from "wasmoon-lua5.1";

export type ScriptFlowContext = {
  /** "Execution flow" local headers (not persisted). */
  globalHeaders: Record<string, string>;
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
};

type ScriptRequest = {
  variables: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => string | undefined;
    all: () => Record<string, string>;
  };
};

type ScriptClient = {
  test: (testName: string, func: () => unknown) => void;
  assert: (condition: unknown, message?: string) => void;
  exit: () => never;
  global: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => string | undefined;
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

function toStringValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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

function makeResponseForScripts(response?: RunnerResponseLike): ScriptResponse {
  if (!response) {
    return {
      status: 0,
      headers: makeHeaders({}),
      body: "",
      contentType: { mimeType: "", charset: "" },
    };
  }
  const bodyRaw = response.body;
  const text = typeof bodyRaw === "string" ? bodyRaw : String(bodyRaw ?? "");
  const ctHeader = response.headers["content-type"];
  const body = resolveScriptBody(text, ctHeader);
  return {
    status: response.statusCode,
    headers: makeHeaders(response.headers),
    body,
    contentType: parseContentTypeHeader(ctHeader),
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
  filePath: string,
  ctx: {
    client: ScriptClient;
    request: ScriptRequest;
    response: ScriptResponse;
  },
): Promise<void> {
  const prev = {
    client: (globalThis as Record<string, unknown>).client,
    request: (globalThis as Record<string, unknown>).request,
    response: (globalThis as Record<string, unknown>).response,
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

  try {
    (globalThis as unknown as Record<string, unknown>).client = ctx.client;
    (globalThis as unknown as Record<string, unknown>).request = ctx.request;
    (globalThis as unknown as Record<string, unknown>).response = ctx.response;

    // Allow CommonJS requires in scripts.
    const req = createRequire(filePath);
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

    const mod = (await import(filePath)) as { default?: unknown };
    const run = mod.default;
    if (typeof run === "function") {
      await (run as () => unknown)();
    }
  } finally {
    (globalThis as unknown as Record<string, unknown>).client = prev.client;
    (globalThis as unknown as Record<string, unknown>).request = prev.request;
    (globalThis as unknown as Record<string, unknown>).response = prev.response;
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
  luaCtx.request = {
    variables: {
      set: (k: string, v: unknown) => ctx.request.variables.set(k, v),
      get: (k: string) => ctx.request.variables.get(k),
      all: () => ctx.request.variables.all(),
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
): Promise<void> => {
  void type;
  void block;
  const mutableVars = vars ?? {};
  for (const script of scripts) {
    const tmpName = path.resolve(getTempName());
    const cwd = path.resolve(process.cwd());
    const tempCwd = path.resolve(path.dirname(filePath || tmpName));
    try {
      process.chdir(tempCwd);

      const requestObj: ScriptRequest = {
        variables: {
          set: (name: string, value: unknown) => {
            if (type === "postRequest") {
              throw new Error(
                "request.variables.set is not available in post-request scripts",
              );
            }
            mutableVars[name] = toStringValue(value);
          },
          get: (name: string) => mutableVars[name],
          all: () => ({ ...mutableVars }),
        },
      };

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
            console.log(`✓ ${testName}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`✗ ${testName}: ${msg}`);
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
            mutableVars[name] = toStringValue(value);
          },
          get: (name: string) => {
            const v = getVariable("global", name);
            return v === undefined ? undefined : toStringValue(v);
          },
          isEmpty: () => Object.keys(getVariables("global")).length === 0,
          clear: (name: string) => deleteVariable("global", name),
          clearAll: () => {
            const vars = getVariables("global");
            for (const k of Object.keys(vars)) deleteVariable("global", k);
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
          // Match JetBrains-style "client.log" behavior.
          console.log(...args);
        },
      };

      const responseObj = makeResponseForScripts(response);

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
        });
      }
    } catch (error) {
      if (error instanceof ScriptExitError) {
        break;
      }
      console.error(
        `Error executing script: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
