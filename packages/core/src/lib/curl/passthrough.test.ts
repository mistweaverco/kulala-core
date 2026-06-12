import { expect, test } from "bun:test";
import type { KulalaOperator } from "../parser/types/operator";
import {
  curlArgvFromOperators,
  curlPassthroughFlagKey,
  kulalaCurlOperatorToArgv,
  mergeCurlArgv,
  mergeCurlPassthroughOperators,
} from "./passthrough";

function op(name: string, args?: string): KulalaOperator {
  return { name: name as KulalaOperator["name"], args, lineNumber: 0 };
}

test("kulala-curl--* maps to long curl options", () => {
  expect(curlPassthroughFlagKey("kulala-curl--insecure")).toBe("--insecure");
  expect(kulalaCurlOperatorToArgv(op("kulala-curl--insecure"))).toEqual([
    "--insecure",
  ]);
  expect(kulalaCurlOperatorToArgv(op("kulala-curl--max-time", "10"))).toEqual([
    "--max-time",
    "10",
  ]);
});

test("kulala-curl-* short form maps to single-letter -flag only", () => {
  expect(curlPassthroughFlagKey("kulala-curl-n")).toBe("-n");
  expect(kulalaCurlOperatorToArgv(op("kulala-curl-n"))).toEqual(["-n"]);
  expect(
    kulalaCurlOperatorToArgv(op("kulala-curl-H", '"Accept: */*"')),
  ).toEqual(["-H", "Accept: */*"]);
  expect(curlPassthroughFlagKey("kulala-curl-insecure")).toBeUndefined();
  expect(curlPassthroughFlagKey("kulala-curl--insecure")).toBe("--insecure");
  expect(
    kulalaCurlOperatorToArgv(op("kulala-curl--header", '"X-Foo: bar baz"')),
  ).toEqual(["--header", "X-Foo: bar baz"]);
});

test("mergeCurlPassthroughOperators: later operator overrides same curl flag", () => {
  const merged = mergeCurlPassthroughOperators([
    op("kulala-curl--max-time", "5"),
    op("kulala-curl--max-time", "10"),
  ]);
  expect(merged).toHaveLength(1);
  expect(kulalaCurlOperatorToArgv(merged[0]!)).toEqual(["--max-time", "10"]);
});

test("curlArgvFromOperators concatenates distinct flags", () => {
  expect(
    curlArgvFromOperators([
      op("kulala-curl--insecure"),
      op("kulala-curl--max-time", "3"),
    ]),
  ).toEqual(["--insecure", "--max-time", "3"]);
});

test("mergeCurlArgv: later layer overrides same flag token", () => {
  expect(
    mergeCurlArgv([
      ["--max-time", "5"],
      ["--max-time", "10"],
    ]),
  ).toEqual(["--max-time", "10"]);
});

test("mergeCurlArgv: -k and --insecure are distinct pass-through flags", () => {
  expect(mergeCurlArgv([["-k"], ["--insecure"]])).toEqual(["-k", "--insecure"]);
});
