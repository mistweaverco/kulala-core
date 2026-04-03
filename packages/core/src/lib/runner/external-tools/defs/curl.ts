import type {
  ArchiveDownloadSpec,
  ExternalToolDefinition,
  PlatformArchKey,
} from "../types";

const CURL_VERSION = "8.19.0";

// Source: https://curl.se/download.html -> "Packages" (stunnel/static-curl builds).
const DOWNLOADS: Partial<Record<PlatformArchKey, ArchiveDownloadSpec>> = {
  "linux-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-linux-x86_64-musl-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "3c5c62815d4a12bebd10c2884038d68102c81e5c058eaad1b3c3e66343634152",
    archiveExeName: "curl",
  },
  "linux-arm64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-linux-aarch64-musl-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "c60f5718765bfc83bff10e7aa8eada2e629e009738b38683164a19482dd43a53",
    archiveExeName: "curl",
  },
  "darwin-arm64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-macos-arm64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "210adf449293bb55e86a7ce26e32a8b00e7fafec570c24d2fe82bec3ff4ac090",
    archiveExeName: "curl",
  },
  "darwin-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-macos-x86_64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "732a165fd450f12bbb01170bb99a6cd00b904d1eeccbe5ecd3e25220007d73f2",
    archiveExeName: "curl",
  },
  "win32-x64": {
    url: `https://github.com/stunnel/static-curl/releases/download/${CURL_VERSION}/curl-windows-x86_64-${CURL_VERSION}.tar.xz`,
    expectedSha256:
      "40241a577f01e06d1ff31e9971fe5b188705f9a4ea9c26133eab237ed8c1528c",
    archiveExeName: "curl.exe",
  },
};

export const CURL_TOOL: ExternalToolDefinition = {
  id: "curl",
  pathEnvVar: "KULALA_CURL_PATH",
  systemCommandNames: ["curl.exe", "curl"],
  binaryFileName: (platform) => (platform === "win32" ? "curl.exe" : "curl"),
  downloadsByPlatform: DOWNLOADS,
  userAgent: "kulala-core",
};
