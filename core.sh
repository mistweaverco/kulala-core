#!/usr/bin/env bash

action=${1:-"run"}
http_file=${2:-"http-example-files/simple.http"}
start_line_cursor=${3:-1}

content=$(cat "$http_file")

# escape backslashes, double quotes, forward slashes, carriage returns, and tabs
escaped_content=$(echo "$content" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\//\\\//g' -e 's/\r/\\r/g' -e 's/\t/\\t/g')
# escape newlines
escaped_content=$(echo "$escaped_content" | sed -e ':a;N;$!ba;s/\n/\\n/g')
# escape curlies
escaped_content=$(echo "$escaped_content" | sed -e 's/{/\\\\{/g' -e 's/}/\\\\}/g')

parse_json="{\"action\":\"$action\", \"filepath\": \"$http_file\", \"content\": \"$escaped_content\", \"limit\": [{\"filter\": \"cursorPosition\", \"line\": $start_line_cursor, \"column\": 1}]}"


echo ".http file content:"
echo "----------------------"
if [ -z "$content" ]; then
  echo "(empty file)"
else
  echo "$content" | nl -ba -w1 -s': '
fi
echo

echo "Actual invocation of Kulala with the following JSON payload:"
echo "----------------------"
echo "\"$parse_json\" | bun run src/index.ts"
echo

echo "Payload sent to Kulala:"
echo "----------------------"
echo "$parse_json" | jq -r '.'
echo

if kulala_response=$(echo "$parse_json" | bun run src/index.ts); then
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
