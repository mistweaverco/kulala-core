#!/usr/bin/env bash

BENCHMARK=${BENCHMARK:-false}
USE_BUILD=${USE_BUILD:-false}
ACTION=${1:-"run"}
HTTP_FILE=${2:-"http-example-files/simple.http"}
START_LINE_CURSOR=${3:-0}
BENCHMARK_OUTPUT_FILE=".tmp/$(basename "$HTTP_FILE").benchmark.txt"

if [[ ! -f "$HTTP_FILE" ]]; then
  echo "Error: file not found: $HTTP_FILE" >&2
  exit 1
fi

# Absolute path avoids wrong script cwd when .http path is relative (see runScripts tempCwd).
if command -v realpath >/dev/null 2>&1; then
  http_file_abs=$(realpath "$HTTP_FILE")
else
  http_file_abs="$(cd "$(dirname "$HTTP_FILE")" && pwd)/$(basename "$HTTP_FILE")"
fi

content=$(cat "$http_file_abs")

# Build JSON with Bun so "content" is one JSON string (newlines, quotes, {{vars}} intact).
parse_json="$(
  KULALA_PAYLOAD_ACTION="$ACTION" \
    KULALA_PAYLOAD_PATH="$http_file_abs" \
    KULALA_PAYLOAD_LINE="$START_LINE_CURSOR" \
    bun -e '
const action = process.env.KULALA_PAYLOAD_ACTION ?? "run";
const filepath = process.env.KULALA_PAYLOAD_PATH;
const line = parseInt(process.env.KULALA_PAYLOAD_LINE ?? "0", 10);
if (!filepath) throw new Error("KULALA_PAYLOAD_PATH missing");
const file = Bun.file(filepath);
const content = await file.text();
console.log(
  JSON.stringify({
    action,
    filepath,
    content,
    limit: line === 0 ? undefined : [{ filter: "cursorPosition", line, column: 1 }],
  }),
);
'
)"

# Use temporary file for input (frees stdin for interactive input like OAuth2)
payload_file=$(mktemp)
echo "$parse_json" > "$payload_file"

echo ".http file content:"
echo "----------------------"
if [[ -z "$content" ]]; then
  echo "(empty file)"
else
  echo "$content" | nl -ba -w1 -s': '
fi
echo

KULALA_CMD=""

if [[ "$USE_BUILD" != "false" ]]; then
  echo "Building Kulala with Bun..."
  if ! bun run build; then
    echo "Build failed. Exiting."
    exit 1
  fi
  echo "Build successful. Using built version of Kulala."
  KULALA_CMD="./packages/core/dist/kulala-core --input-file $payload_file"
else
  KULALA_CMD="bun run packages/core/src/cli.ts --input-file $payload_file"
fi

echo "Actual invocation of Kulala with the following JSON payload:"
echo "----------------------"
echo "$KULALA_CMD"
echo

echo "Payload sent to Kulala:"
echo "----------------------"
echo "$parse_json" | jq -r '.'
echo

if [[ "$BENCHMARK" != "false" ]]; then
  echo "Running with benchmarking enabled. Output will be saved to $BENCHMARK_OUTPUT_FILE"
  if ! kulala_response=$(/usr/bin/time -f "CPU: %P | Max RAM: %M KB | Time: %E" -o "$BENCHMARK_OUTPUT_FILE" $KULALA_CMD); then
    echo "Error running Kulala:"
    echo "---------------------"
    echo "$kulala_response" | jq -r '.'
    echo "Original JSON sent to Kulala:"
    echo "$parse_json"
    rm -f "$payload_file"
    exit 1
  else
    echo "Kulala response:"
    echo "----------------"
    echo "$kulala_response" | jq -r '.'
    echo
    echo "Benchmark results (saved to $BENCHMARK_OUTPUT_FILE):"
    cat "$BENCHMARK_OUTPUT_FILE"
  fi
else
  echo "Running without benchmarking."
  if ! kulala_response=$($KULALA_CMD); then
    echo "Error running Kulala:"
    echo "---------------------"
    echo "$kulala_response" | jq -r '.'
    echo "Original JSON sent to Kulala:"
    echo "$parse_json"
    rm -f "$payload_file"
    exit 1
  fi
  echo "Kulala response:"
  echo "----------------"
  echo "$kulala_response" | jq -r '.'
fi

# Cleanup
rm -f "$payload_file"
