#!/usr/bin/env bash

BENCHMARK=${BENCHMARK:-false}
USE_BUILD=${USE_BUILD:-false}
ACTION=${1:-"run"}
HTTP_FILE=${2:-"http-example-files/simple.http"}
START_LINE_CURSOR=${3:-0}
BENCHMARK_OUTPUT_FILE=".tmp/$(basename "$HTTP_FILE").benchmark.txt"
HAS_BAT_INSTALLED=$(command -v bat)
HAS_JQ_INSTALLED=$(command -v jq)

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

echo_with_bat_with_cat_fallback() {
  local input="$1"
  local language="${2:-txt}"
  local file_name="${3:-"file.txt"}"
  local highlight_line="${4:-0}"
  if [[ "$HAS_BAT_INSTALLED" != "" ]]; then
    echo "$input" | bat --paging=never --language="$language" --file-name="$file_name" --highlight-line="$highlight_line" 2>/dev/null || echo "$input"
  else
    echo "$input"
  fi
  echo
}

echo_with_jq_with_cat_fallback() {
  local input="$1"
  if [[ "$HAS_JQ_INSTALLED" != "" ]]; then
    echo "$input" | jq . 2>/dev/null || echo "$input"
    echo
    return
  fi
  echo "$input"
  echo
}

echo_with_margin() {
  local input="$1"
  local margin_top=${2:-0}
  local margin_bottom=${3:-1}
  if [[ "$margin_top" -gt 0 ]]; then
    for ((i=0; i<margin_top; i++)); do
      echo
    done
  fi
  echo "$input"
  if [[ "$margin_bottom" -gt 0 ]]; then
    for ((i=0; i<margin_bottom; i++)); do
      echo
    done
  fi
}

cleanup_temp_files() {
  rm -f "$payload_file"
}

trap cleanup_temp_files EXIT

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

echo_with_margin "📎 .http file content:"

if [[ -z "$content" ]]; then
  echo "(empty file)"
else
  echo_with_bat_with_cat_fallback "$content" "txt" "$(basename "$HTTP_FILE")" "$START_LINE_CURSOR"
fi
echo

KULALA_CMD=""

if [[ "$USE_BUILD" != "false" ]]; then
  echo_with_margin "⚠️  Building Kulala with Bun..."
  if ! bun run build; then
    echo_with_margin "🚨 Build failed. Exiting."
    exit 1
  fi
  echo_with_margin "✅ Build successful. Using built version of Kulala."
  KULALA_CMD="./packages/core/dist/kulala-core --input-file $payload_file"
else
  KULALA_CMD="bun run packages/core/src/cli.ts --input-file $payload_file"
fi

echo_with_margin "🔎 Running Kulala 🐼 via command"
echo_with_bat_with_cat_fallback "$KULALA_CMD" "bash" "kulala-command.sh"

echo_with_margin "💾 Payload sent to Kulala 🐼"
echo_with_jq_with_cat_fallback "$parse_json"

if [[ "$BENCHMARK" != "false" ]]; then
  echo "⏰ Running with benchmarking enabled. Output will be saved to $BENCHMARK_OUTPUT_FILE"
  echo
  if ! kulala_response=$(/usr/bin/time -f "CPU: %P | Max RAM: %M KB | Time: %E" -o "$BENCHMARK_OUTPUT_FILE" $KULALA_CMD); then
    echo_with_margin "🚨 Error running Kulala 🐼"
    echo_with_jq_with_cat_fallback "$kulala_response"
    exit 1
  else
    echo_with_margin "✅ Kulala 🐼 response:"
    echo_with_jq_with_cat_fallback "$kulala_response"
    echo_with_margin "Benchmark results (saved to $BENCHMARK_OUTPUT_FILE):"
    cat "$BENCHMARK_OUTPUT_FILE"
  fi
else
  if ! kulala_response=$($KULALA_CMD); then
    echo_with_margin "🚨 Error running Kulala 🐼"
    echo_with_jq_with_cat_fallback "$kulala_response"
    exit 1
  fi
  echo_with_margin "✅ Kulala 🐼 response:"
  echo_with_jq_with_cat_fallback "$kulala_response"
fi
