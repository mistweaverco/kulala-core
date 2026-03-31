import path from "path";
import type { KulalaBlock } from "./../parser/types/block";
import type { RunnerResponseLike } from "./types";
import {
  type KulalaScript,
  type KulalaScriptType,
} from "./../parser/types/script";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { createRequire } from "node:module";
import { setVariable, deleteVariable, getVariable } from "../persistence";
import {
  exec,
  execFile,
  execFileSync,
  execSync,
  spawn,
  spawnSync,
} from "node:child_process";
import type { Lua } from "wasmoon-lua5.1";

type ScriptHeaders = {
  valueOf: (name: string) => string | undefined;
  get: (name: string) => string | undefined;
};

type ScriptResponse = {
  status: number;
  headers: ScriptHeaders;
  body: {
    text?: string;
    json?: unknown;
  };
};

type ScriptRequest = {
  variables: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => string | undefined;
    all: () => Record<string, string>;
  };
};

type ScriptClient = {
  global: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => string | undefined;
    delete: (name: string) => boolean;
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
  return { get, valueOf: get };
}

function makeResponseForScripts(response?: RunnerResponseLike): ScriptResponse {
  if (!response) {
    return {
      status: 0,
      headers: makeHeaders({}),
      body: {},
    };
  }
  const bodyRaw = response.body;
  const text = typeof bodyRaw === "string" ? bodyRaw : String(bodyRaw ?? "");
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  return {
    status: response.statusCode,
    headers: makeHeaders(response.headers),
    body: {
      text,
      ...(json !== undefined ? { json } : {}),
    },
  };
}

const getTempName = (): string => {
  const osTempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const timestamp = Date.now();
  const uuid = crypto.randomUUID();
  return path.join(osTempDir, `kulala_script_${timestamp}_${uuid}.js`);
};

const transpiler = new Bun.Transpiler();

const wrapScriptContent = (
  content: string,
  loader: "js" | "jsx" | "ts" | "tsx" = "js",
): string => {
  return transpiler.transformSync(
    `(async() => {
    ${content}
  })();`,
    { loader },
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

    await import(filePath);
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
    global: {
      set: (k: string, v: unknown) => ctx.client.global.set(k, v),
      get: (k: string) => ctx.client.global.get(k),
      delete: (k: string) => ctx.client.global.delete(k),
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
    },
    body: {
      text: ctx.response.body.text,
      json: ctx.response.body.json,
    },
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
): Promise<void> => {
  void type;
  void block;
  const mutableVars = vars ?? {};
  for (const script of scripts) {
    try {
      const tmpName = path.resolve(getTempName());
      const cwd = path.resolve(process.cwd());
      const tempCwd = path.resolve(path.dirname(filePath || tmpName));
      process.chdir(tempCwd);

      const requestObj: ScriptRequest = {
        variables: {
          set: (name: string, value: unknown) => {
            mutableVars[name] = toStringValue(value);
          },
          get: (name: string) => mutableVars[name],
          all: () => ({ ...mutableVars }),
        },
      };

      const clientObj: ScriptClient = {
        global: {
          set: (name: string, value: unknown) => {
            setVariable("global", name, value as Record<string, unknown>);
            mutableVars[name] = toStringValue(value);
          },
          get: (name: string) => {
            const v = getVariable("global", name);
            return v === undefined ? undefined : toStringValue(v);
          },
          delete: (name: string) => deleteVariable("global", name),
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

      process.chdir(cwd);
      if (existsSync(tmpName)) {
        unlinkSync(tmpName);
      }
    } catch (error) {
      console.error(
        `Error executing script: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};
