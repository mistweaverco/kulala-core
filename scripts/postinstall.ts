import * as fs from "fs";

const VERSION = process.env.VERSION || "0.0.0-local";
const VERSION_FILE = "packages/core/version.json";

if (!process.env.VERSION && !process.env.CI) {
  console.warn(
    "⚠️ VERSION not set in non-CI environment. Defaulting to 0.0.0-local.",
  );
}

const versionData = {
  version: VERSION,
};

fs.writeFileSync(VERSION_FILE, JSON.stringify(versionData, null, 2));
console.log(`Generated ${VERSION_FILE} with version: ${VERSION}`);
