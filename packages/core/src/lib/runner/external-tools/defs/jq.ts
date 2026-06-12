import type {
  BinaryDownloadSpec,
  ExternalToolDefinition,
  PlatformArchKey,
} from "../types";

const JQ_VERSION = "1.7.1";
const BASE = `https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}`;

const DOWNLOADS: Partial<Record<PlatformArchKey, BinaryDownloadSpec>> = {
  "linux-x64": {
    url: `${BASE}/jq-linux-amd64`,
    expectedSha256:
      "5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5",
  },
  "linux-arm64": {
    url: `${BASE}/jq-linux-arm64`,
    expectedSha256:
      "4dd2d8a0661df0b22f1bb9a1f9830f06b6f3b8f7d91211a1ef5d7c4f06a8b4a5",
  },
  "darwin-x64": {
    url: `${BASE}/jq-macos-amd64`,
    expectedSha256:
      "4155822bbf5ea90f5c79cf254665975eb4274d426d0709770c21774de5407443",
  },
  "darwin-arm64": {
    url: `${BASE}/jq-macos-arm64`,
    expectedSha256:
      "0bbe619e663e0de2c550be2fe0d240d076799d6f8a652b70fa04aea8a8362e8a",
  },
  "win32-x64": {
    url: `${BASE}/jq-win64.exe`,
    expectedSha256:
      "7451fbbf37feffb9bf262bd97c54f0da558c63f0748e64152dd87b0a07b6d6ab",
  },
};

export const JQ_TOOL: ExternalToolDefinition = {
  id: "jq",
  pathEnvVar: "KULALA_JQ_PATH",
  systemCommandNames: ["jq.exe", "jq"],
  binaryFileName: (platform) => (platform === "win32" ? "jq.exe" : "jq"),
  binaryDownloadsByPlatform: DOWNLOADS,
  userAgent: "kulala-core",
};
