import { spawnSync } from "node:child_process";
import { downloader } from "../downloader";
import type {
  KulalaDocument,
  KulalaFormatInput,
  KulalaHttpFormatResult,
  KulalaParseInput,
  KulalaResponseWrapper,
  KulalaRunInput,
} from "./types";

export type {
  KulalaDocument,
  KulalaFormatInput,
  KulalaHttpFormatResult,
  KulalaParseInput,
  KulalaRequestErrorResponse,
  KulalaRequestSuccessResponse,
  KulalaResponseItem,
  KulalaResponseWrapper,
  KulalaRunInput,
  RunLimit,
} from "./types";

export type InvokeOptions = {
  cwd?: string;
};

let cachedExecutable: string | null = null;

async function executablePath(): Promise<string> {
  if (!cachedExecutable) {
    cachedExecutable = await downloader.ensureInstalled();
  }
  return cachedExecutable;
}

function invoke(
  payload: Record<string, unknown>,
  options: InvokeOptions = {},
): unknown {
  const exe = cachedExecutable;
  if (!exe) {
    throw new Error("kulala-core executable not resolved");
  }

  const result = spawnSync(exe, [], {
    input: `${JSON.stringify(payload)}\n`,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
    cwd: options.cwd,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        `kulala-core exited with code ${result.status ?? "unknown"}`,
    );
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error("kulala-core returned empty output");
  }

  return JSON.parse(stdout);
}

async function invokeAction(
  payload: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<unknown> {
  await executablePath();
  return invoke(payload, options);
}

export async function parseDocument(
  input: KulalaParseInput,
  options: InvokeOptions = {},
): Promise<KulalaDocument> {
  return (await invokeAction(
    {
      action: "parse",
      content: input.content,
      filepath: input.filepath,
    },
    options,
  )) as KulalaDocument;
}

export async function formatDocument(
  input: KulalaFormatInput,
  options: InvokeOptions = {},
): Promise<KulalaHttpFormatResult> {
  return (await invokeAction(
    {
      action: "format",
      content: input.content,
      filepath: input.filepath,
      formatBody: input.formatBody,
      bodyFormat: input.bodyFormat,
      defaults: input.defaults,
    },
    options,
  )) as KulalaHttpFormatResult;
}

export async function runDocument(
  input: KulalaRunInput,
  options: InvokeOptions = {},
): Promise<{ doc: KulalaDocument; response: KulalaResponseWrapper }> {
  const doc = await parseDocument(input, options);
  const response = (await invokeAction(
    {
      action: "run",
      content: input.content,
      filepath: input.filepath,
      env: input.env ?? "default",
      limit: input.limit,
      haltOnError: input.haltOnError,
    },
    options,
  )) as KulalaResponseWrapper;

  return { doc, response };
}

export const kulalaCore = {
  parse: parseDocument,
  validate: parseDocument,
  format: formatDocument,
  run: runDocument,
};
