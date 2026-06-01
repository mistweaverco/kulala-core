#!/usr/bin/env bash

set -eo pipefail

if [ -z "$CI" ]; then
  bun test --only-failures --randomize
  exit $?
fi

# Strip the first line (bun test version) and
# strip empty newlines and invisible characters for cleaner logs in CI.

export FORCE_COLOR=1;

bun test --only-failures --randomize 2>&1 | tr -d '\r' | sed -r "s/\x1B\[[0-9;]*[KkJjGgHhA-DF-F]//g" | sed '/^[[:space:]]*$/d'
