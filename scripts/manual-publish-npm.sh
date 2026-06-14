#!/usr/bin/env bash
set -euo pipefail

export RESET_VERSIONS=true
exec "$(dirname "$0")/publish-npm.sh"
