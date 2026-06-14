#!/usr/bin/env bash
set -euo pipefail

WRAPPER_DIR="packages/core-npm-wrapper"

if [ -z "${VERSION:-}" ]; then
  echo "VERSION environment variable is not set. Exiting."
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun install --frozen-lockfile

npm --prefix "${WRAPPER_DIR}" version "${VERSION}" --no-git-tag-version

sed -i "s/export const KULALA_CORE_VERSION = \".*\";/export const KULALA_CORE_VERSION = \"${VERSION}\";/" "${WRAPPER_DIR}/src/versions/backend.ts"

if [ "${RESET_VERSIONS:-false}" = "true" ]; then
  npm version "0.0.0" --no-git-tag-version
fi

cd "../core-npm-wrapper"
rm -rf dist/*
bun run build
npm publish --access public

if [ "${RESET_VERSIONS:-false}" = "true" ]; then
  npm version "0.0.0" --no-git-tag-version
fi
