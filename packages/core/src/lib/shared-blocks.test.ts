import { expect, test } from "bun:test";
import type { KulalaBlock } from "./parser/types/block";
import {
  isSharedBlockName,
  isSharedEachBlockName,
  KULALA_SHARED_BLOCK,
  KULALA_SHARED_EACH_BLOCK,
  sharedBlockHasHttpRequest,
} from "./shared-blocks";

test("isSharedBlockName", () => {
  expect(isSharedBlockName(KULALA_SHARED_BLOCK)).toBe(true);
  expect(isSharedBlockName(KULALA_SHARED_EACH_BLOCK)).toBe(true);
  expect(isSharedBlockName("Shared")).toBe(false);
  expect(isSharedBlockName("FOO1")).toBe(false);
});

test("isSharedEachBlockName", () => {
  expect(isSharedEachBlockName(KULALA_SHARED_EACH_BLOCK)).toBe(true);
  expect(isSharedEachBlockName(KULALA_SHARED_BLOCK)).toBe(false);
});

test("sharedBlockHasHttpRequest", () => {
  const withUrl = {
    request: { url: "https://example.com" },
  } as KulalaBlock;
  const nop = { request: { url: "NOP" } } as KulalaBlock;
  const empty = { request: { url: "" } } as KulalaBlock;
  expect(sharedBlockHasHttpRequest(withUrl)).toBe(true);
  expect(sharedBlockHasHttpRequest(nop)).toBe(false);
  expect(sharedBlockHasHttpRequest(empty)).toBe(false);
});
