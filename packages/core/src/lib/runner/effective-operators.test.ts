import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaOperator } from "../parser/types/operator";
import { curlArgvFromOperators } from "../curl/passthrough";
import {
  getEffectiveCurlArgv,
  getEffectiveOperators,
} from "./effective-operators";

const tmpRoot = join(import.meta.dir, ".tmp-effective-operators-test");

beforeEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function op(name: string, args?: string): KulalaOperator {
  return { name: name as KulalaOperator["name"], args, lineNumber: 0 };
}

test("block operator overrides file-header operator with same name", () => {
  const doc: KulalaDocument = {
    directives: [],
    blocks: [],
    fileHeaderOperators: [op("kulala-curl--max-time", "30")],
  };
  const block = {
    name: "A",
    operators: [op("kulala-curl--max-time", "5")],
  } as KulalaBlock;
  const argv = curlArgvFromOperators(getEffectiveOperators(doc, block));
  expect(argv).toEqual(["--max-time", "5"]);
});

test("file-header and block curl operators merge by flag", () => {
  const doc: KulalaDocument = {
    directives: [],
    blocks: [],
    fileHeaderOperators: [op("kulala-curl--insecure")],
  };
  const block = {
    name: "A",
    operators: [op("kulala-curl--max-time", "10")],
  } as KulalaBlock;
  const argv = curlArgvFromOperators(getEffectiveOperators(doc, block));
  expect(argv).toEqual(["--insecure", "--max-time", "10"]);
});

test("getEffectiveCurlArgv: env defaults merged with request operators", () => {
  const dir = join(tmpRoot, "env-defaults");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: { $kulalaDefaultCurlOptions: ["--insecure"] },
      default: {},
    }),
  );

  const doc: KulalaDocument = {
    directives: [],
    blocks: [],
    fileHeaderOperators: [],
  };
  const block = {
    name: "A",
    operators: [op("kulala-curl--max-time", "10")],
  } as KulalaBlock;

  expect(getEffectiveCurlArgv(doc, block, "default", dir)).toEqual([
    "--insecure",
    "--max-time",
    "10",
  ]);
});

test("getEffectiveCurlArgv: request operator overrides env default for same flag", () => {
  const dir = join(tmpRoot, "override");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "http-client.env.json"),
    JSON.stringify({
      $kulalaShared: { $kulalaDefaultCurlOptions: ["--max-time 30"] },
      default: {},
    }),
  );

  const doc: KulalaDocument = {
    directives: [],
    blocks: [],
    fileHeaderOperators: [],
  };
  const block = {
    name: "A",
    operators: [op("kulala-curl--max-time", "5")],
  } as KulalaBlock;

  expect(getEffectiveCurlArgv(doc, block, "default", dir)).toEqual([
    "--max-time",
    "5",
  ]);
});
