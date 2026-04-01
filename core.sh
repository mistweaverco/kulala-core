#!/usr/bin/env bash

action=${1:-"run"}
http_file=${2:-"http-example-files/simple.http"}
start_line_cursor=${3:-0}

if [[ ! -f "$http_file" ]]; then
  echo "Error: file not found: $http_file" >&2
  exit 1
fi

# Absolute path avoids wrong script cwd when .http path is relative (see runScripts tempCwd).
if command -v realpath >/dev/null 2>&1; then
  http_file_abs=$(realpath "$http_file")
else
  http_file_abs="$(cd "$(dirname "$http_file")" && pwd)/$(basename "$http_file")"
fi

content=$(cat "$http_file_abs")

# Build JSON with Bun so "content" is one JSON string (newlines, quotes, {{vars}} intact).
parse_json="$(
  KULALA_PAYLOAD_ACTION="$action" \
    KULALA_PAYLOAD_PATH="$http_file_abs" \
    KULALA_PAYLOAD_LINE="$start_line_cursor" \
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

echo "Actual invocation of Kulala with the following JSON payload:"
echo "----------------------"
echo "bun run packages/core/src/cli.ts --input-file $payload_file"
echo

echo "Payload sent to Kulala:"
echo "----------------------"
echo "$parse_json" | jq -r '.'
echo

if kulala_response=$(bun run packages/core/src/cli.ts --input-file "$payload_file"); then
  echo "Kulala response:"
  echo "----------------"
  echo "$kulala_response" | jq -r '.' || echo "$kulala_response"
else
  echo "Error running Kulala:"
  echo "---------------------"
  echo "$kulala_response" | jq -r '.'
  echo "Original JSON sent to Kulala:"
  echo "$parse_json"
fi

# Cleanup
rm -f "$payload_file"
