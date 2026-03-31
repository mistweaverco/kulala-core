# Embedded cURL (vendored)

`kulala-core` uses a vendored `curl` binary by default.

This directory is intended to be **populated during build/release** and is not meant for “regular assets” like images.

Additionally, when installed as a library, `kulala-core` can download a compatible `curl` binary into a user-writable cache directory during install.

## Layout

Place a `curl` binary at:

- `vendor/curl/<platform>-<arch>/curl` (Linux/macOS)
- `vendor/curl/<platform>-<arch>/curl.exe` (Windows)

Where:

- `<platform>` is `process.platform` (e.g. `linux`, `darwin`, `win32`)
- `<arch>` is `process.arch` (e.g. `x64`, `arm64`)

Example:

- `vendor/curl/linux-x64/curl`

## Runtime override

- `KULALA_CURL_PATH=/path/to/curl`

## Install-time download (library consumption)

On `postinstall`, `kulala-core` tries to download `curl` to:

- `${KULALA_CORE_CURL_CACHE_DIR}/curl/<platform>-<arch>/curl[.exe]` (if set)
- otherwise:
  - Linux/Unix: `${XDG_CACHE_HOME:-~/.cache}/kulala/curl/<platform>-<arch>/curl[.exe]`
  - macOS: `~/Library/Caches/kulala/curl/<platform>-<arch>/curl[.exe]`
  - Windows: `%LOCALAPPDATA%\\kulala\\curl\\<platform>-<arch>\\curl.exe`

The download URLs are pinned and hard-coded to a fixed curl version.
