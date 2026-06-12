export type ExternalToolId = "curl" | "jq";

/** Expand with `"grpcurl" | "websocat"` when those definitions are added. */
export type PlatformArchKey = `${NodeJS.Platform}-${string}`;

export type ArchiveDownloadSpec = {
  url: string;
  expectedSha256: string;
  /** File name inside the extracted archive root (e.g. `curl`, `curl.exe`). */
  archiveExeName: string;
};

export type BinaryDownloadSpec = {
  url: string;
  expectedSha256: string;
};

export type ExternalToolDefinition = {
  id: ExternalToolId;
  /** Env var with full path to the binary (highest priority). */
  pathEnvVar: string;
  /** Names to try with `command -v` / `where` (platform-specific first). */
  systemCommandNames: string[];
  /** Filename under the versioned cache directory (e.g. `curl` / `curl.exe`). */
  binaryFileName: (platform: NodeJS.Platform) => string;
  /** Pinned `.tar.xz` archives per `process.platform`-`process.arch`. */
  downloadsByPlatform?: Partial<Record<PlatformArchKey, ArchiveDownloadSpec>>;
  /** Pinned single-file executables per `process.platform`-`process.arch`. */
  binaryDownloadsByPlatform?: Partial<
    Record<PlatformArchKey, BinaryDownloadSpec>
  >;
  userAgent: string;
};
