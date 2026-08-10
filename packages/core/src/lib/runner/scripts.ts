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
  buildScriptRequestApi,
  buildScriptRequestContextFromBlock,
  type ScriptRequestContext,
} from "./script-request-context";
import { buildKulalaScriptApi } from "./kulala-script-api";
import { ScriptPromptError } from "./script-prompt-error";
import {
  ScriptAbortError,
  ScriptReplayError,
  ScriptSkipError,
} from "./script-control-error";
import { makeResponseForScripts, type ScriptResponse } from "./script-response";

export type { ScriptContentType } from "./script-response";

export type ScriptRunScope = {
  /** Stable document id for request-scoped variables and prompts. */
  stableDocId: string;
  doc?: import("../parser/types").KulalaDocument;
  env?: string;
  resolver?: import("./types").VariableResolver;
  runRequestStack?: string[];
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

class ScriptExitError extends Error {
  override name = "ScriptExitError";
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
    `export default async function kulalaWrappedScript() {\nconst require = globalThis.require;\n${content}\n}`,
  );
};

/**
 * Filename passed to `createRequire` so Node walks `node_modules` from the
 * HTTP document (or external script) directory - not from the OS temp file
 * where the wrapped script is written for `import()`.
 */
const resolveRequireFilename = (
  documentDir: string,
  script: KulalaScript,
): string => {
  if (script.source === "file" && script.filepath) {
    return path.resolve(documentDir, script.filepath);
  }
  return path.join(documentDir, "__kulala_script_require__.js");
};

async function executeJsTsScript(
  modulePath: string,
  ctx: {
    client: ScriptClient;
    request: ScriptRequest;
    response: ScriptResponse;
    kulala: ReturnType<typeof buildKulalaScriptApi>;
    /** Absolute path used only for CommonJS `require` resolution. */
    requireFilename: string;
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

    // Allow CommonJS requires in scripts (resolve from document/script dir).
    const req = createRequire(ctx.requireFilename);
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
    kulala: ReturnType<typeof buildKulalaScriptApi>;
  },
): Promise<void> {
  const mod = await import("wasmoon-lua5.1");

  // Bun `--compile` produces a single binary without `node_modules` on disk.
  // `wasmoon-lua5.1` loads `dist/liblua5.1.wasm` via filesystem at runtime,
  // so we force Bun to embed the WASM and pass a resolved location to the factory.
  const createLuaEngine = async (): Promise<Lua> => {
    type LuaFactoryInstance = {
      createEngine: () => Promise<Lua>;
    };
    type LuaFactoryConstructor = new (
      wasmLocationOrAsset?: unknown,
    ) => LuaFactoryInstance;

    const LuaFactoryCtor =
      (mod as unknown as { LuaFactory?: unknown }).LuaFactory ??
      (mod as unknown as { default?: { LuaFactory?: unknown } }).default
        ?.LuaFactory ??
      undefined;

    if (LuaFactoryCtor && typeof LuaFactoryCtor === "function") {
      const LuaFactory = LuaFactoryCtor as LuaFactoryConstructor;
      let wasmAsset: unknown = undefined;
      try {
        const wasmMod =
          (await import("wasmoon-lua5.1/dist/liblua5.1.wasm")) as unknown as {
            default?: unknown;
          };
        wasmAsset = wasmMod.default;
      } catch {
        // If this import fails (older wasmoon package layout), fall back below.
      }

      try {
        // Wasmoon supports passing a custom wasm location as the first argument
        // in browser/web setups; in Bun it also forces the asset to be bundled.
        const factory = new LuaFactory(wasmAsset);
        return await factory.createEngine();
      } catch {
        // Some versions expect the wasm location argument to be omitted/optional.
        const factory = new LuaFactory();
        return await factory.createEngine();
      }
    }

    const LuaCtor =
      (mod as unknown as { Lua?: unknown }).Lua ??
      (mod as unknown as { default?: { Lua?: unknown } }).default?.Lua ??
      undefined;
    if (
      !LuaCtor ||
      typeof (LuaCtor as { create?: unknown }).create !== "function"
    ) {
      throw new Error(
        "Lua runtime is unavailable (Lua/LuaFactory export not found)",
      );
    }
    return await (LuaCtor as { create: () => Promise<Lua> }).create();
  };

  const lua = await createLuaEngine();
  const luaCtx = lua.ctx as { [k: string]: unknown };

  // Bridge: mirror the JS shape closely.
  luaCtx.client = {
    log: (...args: unknown[]) => ctx.client.log(...args),
    test: (name: string, func: unknown) =>
      ctx.client.test(name, func as () => unknown),
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
    skip: () => req.skip(),
    abort: (message?: string) => req.abort(message),
    replay: () => req.replay(),
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

  // `$kulala` cannot be referenced as an identifier in Lua, but can be accessed via `_G["$kulala"]`.
  // Also expose as `kulala` for convenience.
  luaCtx.kulala = ctx.kulala;
  luaCtx["$kulala"] = ctx.kulala;

  // JetBrains parity helpers (Lua side).
  luaCtx.sleep = (ms: number) =>
    new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, Number(ms) || 0)),
    );
  luaCtx.atob = (data: string) =>
    Buffer.from(String(data), "base64").toString("binary");
  luaCtx.btoa = (data: string) =>
    Buffer.from(String(data), "binary").toString("base64");

  // Child process helpers (same names as JS script globals).
  luaCtx.exec = exec;
  luaCtx.execFile = execFile;
  luaCtx.execSync = execSync;
  luaCtx.execFileSync = execFileSync;
  luaCtx.spawn = spawn;
  luaCtx.spawnSync = spawnSync;

  try {
    const prelude = `
-- kulala-core Lua helpers
local function __kulala_is_array(t)
  if type(t) ~= "table" then return false end
  local n = #t
  for k, _ in pairs(t) do
    if type(k) ~= "number" or k < 1 or k > n or k % 1 ~= 0 then
      return false
    end
  end
  return true
end

local function __kulala_escape_str(s)
  s = tostring(s)
  s = s:gsub("\\\\", "\\\\\\\\")
  s = s:gsub("\\n", "\\\\n")
  s = s:gsub("\\r", "\\\\r")
  s = s:gsub("\\t", "\\\\t")
  s = s:gsub("\\"", "\\\\\\"")
  return "\\"" .. s .. "\\""
end

local function __kulala_json_encode(v)
  local tv = type(v)
  if tv == "nil" then return "null" end
  if tv == "string" then return __kulala_escape_str(v) end
  if tv == "number" then return tostring(v) end
  if tv == "boolean" then return v and "true" or "false" end
  if tv ~= "table" then return __kulala_escape_str(v) end

  if __kulala_is_array(v) then
    local out = {}
    for i = 1, #v do
      out[#out + 1] = __kulala_json_encode(v[i])
    end
    return "[" .. table.concat(out, ",") .. "]"
  end

  local out = {}
  for k, val in pairs(v) do
    out[#out + 1] = __kulala_escape_str(k) .. ":" .. __kulala_json_encode(val)
  end
  return "{" .. table.concat(out, ",") .. "}"
end

-- Wrap setters so Lua tables are passed as JSON strings to JS.
do
  local __orig_req_set = request and request.variables and request.variables.set
  if type(__orig_req_set) == "function" then
    request.variables.set = function(name, value)
      if type(value) == "table" then
        return __orig_req_set(name, __kulala_json_encode(value))
      end
      return __orig_req_set(name, value)
    end
  end

  local __orig_global_set = client and client.global and client.global.set
  if type(__orig_global_set) == "function" then
    client.global.set = function(name, value)
      if type(value) == "table" then
        return __orig_global_set(name, __kulala_json_encode(value))
      end
      return __orig_global_set(name, value)
    end
  end
end
`;

    await lua.doString(`${prelude}\n${content}`);
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
      meta?: Pick<KulalaScriptConsoleLine, "kind" | "testName" | "status">,
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
          ...meta,
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

    const testNameStack: string[] = [];

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
          testNameStack.push(testName);
          try {
            func();
            testNameStack.pop();
            emitConsoleLine("log", `${testName}`, captureJsCallsite(), {
              kind: "test",
              testName,
              status: "pass",
            });
          } catch (e) {
            testNameStack.pop();
            const msg = e instanceof Error ? e.message : String(e);
            emitConsoleLine(
              "error",
              `${testName}: ${msg}`,
              captureJsCallsite(),
              {
                kind: "test",
                testName,
                status: "fail",
              },
            );
            throw e;
          }
        },
        assert: (condition: unknown, message?: string) => {
          const text = message ?? "client.assert failed";
          const parentTest = testNameStack.at(-1);
          if (!condition) {
            emitConsoleLine("error", text, captureJsCallsite(), {
              kind: "assert",
              testName: parentTest,
              status: "fail",
            });
            throw new Error(text);
          }
          emitConsoleLine("log", text, captureJsCallsite(), {
            kind: "assert",
            testName: parentTest,
            status: "pass",
          });
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
        doc: scope?.doc,
        filePath,
        flow,
        env: scope?.env ?? "default",
        resolver: scope?.resolver,
        runRequestStack: scope?.runRequestStack,
      });

      if (script.lang === "lua") {
        await executeLuaScript(script.content, {
          client: clientObj,
          request: requestObj,
          response: responseObj,
          kulala: kulalaApi,
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
          requireFilename: resolveRequireFilename(tempCwd, script),
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
        error instanceof ScriptAbortError ||
        error instanceof ScriptReplayError
      ) {
        throw error;
      }
      emitConsoleLine(
        "error",
        `Error executing script: ${error instanceof Error ? error.message : String(error)}`,
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
