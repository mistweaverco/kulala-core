import path from "path";
import type { KulalaBlock } from "./../parser/types/block";
import { type Response } from "got";
import {
  type KulalaScript,
  type KulalaScriptType,
} from "./../parser/types/script";
import { unlinkSync, writeFileSync } from "fs";
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

const executeScript = async (filePath: string): Promise<void> => {
  try {
    globalThis.console = {
      log: (...args: any[]) => {},
      error: (...args: any[]) => {},
      warn: (...args: any[]) => {},
      info: (...args: any[]) => {},
    };
    // TODO: Pass actual response data to the script context
    globalThis.response = {
      body: {
        json: {
          token: "fake-token",
        },
      },
      status: 200,
      headers: {},
    };
    await import(filePath);
  } catch (error) {
    console.error(error);
  }
};

export const runScripts = async (
  scripts: KulalaScript[],
  type: KulalaScriptType,
  block: KulalaBlock,
  filePath?: string,
  response?: Response,
): Promise<void> => {
  for (const script of scripts) {
    try {
      const tmpName = path.resolve(getTempName());
      const cwd = path.resolve(process.cwd());
      const tempCwd = path.resolve(path.dirname(filePath || tmpName));
      process.chdir(tempCwd);
      writeFileSync(tmpName, wrapScriptContent(script.content), "utf-8");
      await executeScript(tmpName);
      process.chdir(cwd);
      unlinkSync(tmpName);
    } catch (error) {
      console.error(
        `Error executing script: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};
