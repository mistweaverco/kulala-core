#!/usr/bin/env bash

content=$(cat test/simple.http)

# escape backslashes, double quotes, forward slashes, carriage returns, and tabs
escaped_content=$(echo "$content" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\//\\\//g' -e 's/\r/\\r/g' -e 's/\t/\\t/g')
# escape newlines
escaped_content=$(echo "$escaped_content" | sed -e ':a;N;$!ba;s/\n/\\n/g')
# escape curlies
escaped_content=$(echo "$escaped_content" | sed -e 's/{/\\\\{/g' -e 's/}/\\\\}/g')

parse_json="{\"action\":\"parse\", \"content\": \"$escaped_content\"}"

if kulala_response=$(echo "$parse_json" | bun run src/index.ts); then
  echo "$kulala_response" | jq -r '.'
else
  echo "Error running Kulala:"
  echo "$kulala_response"
  echo "Original JSON sent to Kulala:"
  echo "$parse_json"
fi
