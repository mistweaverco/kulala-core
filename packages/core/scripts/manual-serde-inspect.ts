import * as fs from "fs/promises";
import { diffLines } from "diff";
import pc from "picocolors";
import { deserializeHttp, serializeHttp } from "./../src/index";

let inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: bun run manual-serde-inspect.ts <input-file>");
  process.exit(1);
}

inputFile = new URL(inputFile, import.meta.url).pathname;

const httpText = await fs.readFile(inputFile, "utf-8");
const doc = await deserializeHttp(httpText, inputFile);
const roundTrip = serializeHttp(doc);
const changes = diffLines(httpText, roundTrip);
const hasChanges = changes.some((part) => part.added || part.removed);
if (!hasChanges) {
  console.log(pc.green("No changes detected!"));
  process.exit(0);
}
changes.forEach((part) => {
  const lines = part.value.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  lines.forEach((line) => {
    if (part.added) {
      console.log(pc.green(`+ ${line}`));
    } else if (part.removed) {
      console.log(pc.red(`- ${line}`));
    } else {
      console.log(pc.gray(`  ${line}`));
    }
  });
});
