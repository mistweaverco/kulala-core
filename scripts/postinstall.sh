#!/usr/bin/env bash

set -eo pipefail

# Generate version.json from VERSION environment variable

if [ -z "$VERSION" ] && [ -z "$CI" ]; then
  echo "⚠️ VERSION not set in non-CI environment. Defaulting to 0.0.0-local."
  VERSION="0.0.0-local"
elif [ -z "$VERSION" ]; then
  echo "VERSION not set in CI environment. Exiting."
  exit 1
fi

VERSION_FILE="packages/core/version.json"

jq -n --arg version "$VERSION" '{version: $version}' > $VERSION_FILE


