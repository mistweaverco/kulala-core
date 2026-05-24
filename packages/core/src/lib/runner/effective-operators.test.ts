import { expect, test } from "bun:test";
import type { KulalaDocument } from "../parser/types";
import type { KulalaBlock } from "../parser/types/block";
import type { KulalaOperator } from "../parser/types/operator";
import { getEffectiveOperators } from "./effective-operators";
import { curlArgvFromOperators } from "../curl/passthrough";

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
