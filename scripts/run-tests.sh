#!/usr/bin/env bash

set -eo pipefail

if [ -z "$CI" ]; then
  bun test --only-failures --randomize
  exit $?
fi

bun test --randomize
