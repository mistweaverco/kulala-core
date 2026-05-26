import type { KulalaBlock } from "./parser/types/block";

/** Kulala `###` block name for document-wide shared variables and scripts. */
export const KULALA_SHARED_BLOCK = "KULALA_SHARED";
/** Kulala `###` block name; shared scripts run before each request in the file. */
export const KULALA_SHARED_EACH_BLOCK = "KULALA_SHARED_EACH";

export function isSharedBlockName(name: string | undefined): boolean {
  return name === KULALA_SHARED_BLOCK || name === KULALA_SHARED_EACH_BLOCK;
}

export function isSharedEachBlockName(name: string | undefined): boolean {
  return name === KULALA_SHARED_EACH_BLOCK;
}

/** True when the shared block defines an HTTP request to run (not `NOP` / empty). */
export function sharedBlockHasHttpRequest(block: KulalaBlock): boolean {
  const url = block.request?.url;
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "") return false;
  return trimmed.toUpperCase() !== "NOP";
}
