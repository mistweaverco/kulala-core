import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { mergeCurlArgv, splitCurlOperatorArgs } from "../curl/passthrough";
import {
  dirsUpward,
  HTTP_CLIENT_ENV_JSON,
  HTTP_CLIENT_PRIVATE_ENV_JSON,
} from "./env-files";
import { KULALA_SHARED_KEY } from "./default-headers";

/** Kulala-only default curl argv under `$kulalaShared` or per-environment. */
export const DEFAULT_CURL_OPTIONS_KEY = "$kulalaDefaultCurlOptions";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function curlOptionsArrayFromValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    out.push(...splitCurlOperatorArgs(item));
  }
  return out;
}

function readDefaultCurlOptionsFromFile(
  filePath: string,
  env: string,
): { kulalaShared: string[]; perEnv: string[] } {
  const kulalaShared: string[] = [];
  const perEnv: string[] = [];
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { kulalaShared, perEnv };

    const sharedSection = parsed[KULALA_SHARED_KEY];
    if (isPlainObject(sharedSection)) {
      kulalaShared.push(
        ...curlOptionsArrayFromValue(sharedSection[DEFAULT_CURL_OPTIONS_KEY]),
      );
    }

    const envSection = parsed[env];
    if (isPlainObject(envSection)) {
      perEnv.push(
        ...curlOptionsArrayFromValue(envSection[DEFAULT_CURL_OPTIONS_KEY]),
      );
    }
  } catch {
    // ignore unreadable files
  }
  return { kulalaShared, perEnv };
}

/**
 * Load merged default curl argv from http-client.env.json files.
 * Each file contributes two layers: `$kulalaShared.$kulalaDefaultCurlOptions`
 * then `[env].$kulalaDefaultCurlOptions` (later overrides earlier).
 * Files are merged root → closest directory (closest wins), matching env variable resolution.
 */
export function loadDefaultCurlOptions(
  env: string,
  startDir: string,
): string[] {
  const dirs = dirsUpward(startDir);
  const layers: string[][] = [];

  for (const fileName of [
    HTTP_CLIENT_ENV_JSON,
    HTTP_CLIENT_PRIVATE_ENV_JSON,
  ] as const) {
    for (let i = dirs.length - 1; i >= 0; i--) {
      const p = join(dirs[i]!, fileName);
      if (!existsSync(p)) continue;
      const parsed = readDefaultCurlOptionsFromFile(p, env);
      if (parsed.kulalaShared.length > 0) layers.push(parsed.kulalaShared);
      if (parsed.perEnv.length > 0) layers.push(parsed.perEnv);
    }
  }

  return mergeCurlArgv(layers);
}
