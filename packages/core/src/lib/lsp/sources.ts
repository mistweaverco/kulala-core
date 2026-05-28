import {
  LspCompletionItemKind,
  LspInsertTextFormat,
  type LspCompletionItem,
} from "./types";

type SourceItem = {
  label: string;
  insertText?: string;
  documentation?: string;
};

function makeItem(opts: {
  item: SourceItem;
  description?: string;
  kind?: number;
  insertTextFormat?: number;
  sortText?: string;
}): LspCompletionItem {
  const { item, description, kind, insertTextFormat, sortText } = opts;
  return {
    label: item.label,
    labelDetails: description ? { description } : undefined,
    kind,
    detail: item.insertText ?? item.label,
    documentation: item.documentation
      ? { kind: "markdown", value: item.documentation }
      : undefined,
    insertText: item.insertText ?? item.label,
    insertTextFormat,
    sortText,
  };
}

export function staticCompletionItems(sourceName: string): LspCompletionItem[] {
  const kindValue = LspCompletionItemKind.Value;
  const kindSnippet = LspCompletionItemKind.Snippet;
  const formatSnippet = LspInsertTextFormat.Snippet;

  // These are ported from kulala.nvim `lua/kulala/cmd/lsp_sources.lua`.
  const methods: SourceItem[] = [
    { label: "GET", insertText: "GET " },
    { label: "POST", insertText: "POST " },
    { label: "PUT", insertText: "PUT " },
    { label: "DELETE", insertText: "DELETE " },
    { label: "PATCH", insertText: "PATCH " },
    { label: "HEAD", insertText: "HEAD " },
    { label: "OPTIONS", insertText: "OPTIONS " },
    { label: "TRACE", insertText: "TRACE " },
    { label: "CONNECT", insertText: "CONNECT " },
    { label: "GRAPHQL", insertText: "GRAPHQL " },
    { label: "GRPC", insertText: "GRPC " },
    { label: "WS", insertText: "WS " },
  ];

  const schemes: SourceItem[] = [
    { label: "http", insertText: "http://" },
    { label: "https", insertText: "https://" },
    { label: "ws", insertText: "ws://" },
    { label: "wss", insertText: "wss://" },
  ];

  const commands: SourceItem[] = [
    { label: "run #", insertText: "run #", documentation: "Run request #name" },
    {
      label: "run ../",
      insertText: "run ",
      documentation: "Run requests in file",
    },
    {
      label: "import",
      insertText: "import ",
      documentation: "Import requests",
    },
  ];

  const metadata: SourceItem[] = [
    {
      label: "prompt",
      insertText: "prompt ",
      documentation: "Prompt `variable` `prompt string`",
    },
    {
      label: "secret",
      insertText: "secret ",
      documentation: "Secret prompt `variable` `prompt string`",
    },
    { label: "curl", insertText: "curl", documentation: "Curl flag" },
    { label: "grpc", insertText: "grpc", documentation: "Grpc flag" },
    {
      label: "accept chunked",
      insertText: "accept chunked",
      documentation: "Accept chunked responses",
    },
    {
      label: "env-stdin-cmd-pre",
      insertText: "env-stdin-cmd-pre ",
      documentation: "Set env variable with external cmd before request",
    },
    {
      label: "env-stdin-cmd",
      insertText: "env-stdin-cmd ",
      documentation: "Set env variable with external cmd",
    },
    {
      label: "env-json-key",
      insertText: "env-json-key ",
      documentation: "Set env variable with json key",
    },
    {
      label: "stdin-cmd-pre",
      insertText: "stdin-cmd-pre ",
      documentation: "Run external command before request",
    },
    {
      label: "stdin-cmd",
      insertText: "stdin-cmd ",
      documentation: "Run external command",
    },
    {
      label: "jq",
      insertText: "jq ",
      documentation: "Filter response body with jq",
    },
    {
      label: "delay",
      insertText: "delay ",
      documentation: "Delay running request for .. ms",
    },
    {
      label: "attach-cookie-jar",
      insertText: "attach-cookie-jar",
      documentation: "Attach cookies from cookie jar",
    },
    {
      label: "no-cookie-jar",
      insertText: "no-cookie-jar",
      documentation: "Do not save cookies to cookie jar",
    },
  ];

  const curl: SourceItem[] = [
    {
      label: "curl-compressed",
      insertText: "curl-compressed",
      documentation: "Decompress response",
    },
    {
      label: "curl-location",
      insertText: "curl-location",
      documentation: "Follow redirects",
    },
    {
      label: "curl-no-buffer",
      insertText: "curl-no-buffer",
      documentation: "Disable buffering",
    },
    {
      label: "curl-insecure",
      insertText: "curl-insecure",
      documentation: "Skip verification",
    },
    {
      label: "curl-data-urlencode",
      insertText: "curl-data-urlencode",
      documentation: "Urlencode payload",
    },
  ];

  const grpc: SourceItem[] = [
    {
      label: "grpc-import-path",
      insertText: "grpc-import-path",
      documentation: "Proto import path",
    },
    {
      label: "grpc-proto",
      insertText: "grpc-proto",
      documentation: "Proto file",
    },
    {
      label: "grpc-protoset",
      insertText: "grpc-protoset",
      documentation: "Protoset file",
    },
    {
      label: "grpc-plaintext",
      insertText: "grpc-plaintext",
      documentation: "No TLS",
    },
    { label: "grpc-v", insertText: "grpc-verbose", documentation: "Verbose" },
  ];

  const headerValues: SourceItem[] = [
    { label: "Bearer " },
    { label: "Basic " },
    { label: "Digest " },
    { label: "NTLM " },
    { label: "Negotiate" },
    { label: "AWS" },
    { label: "application/json" },
    { label: "application/xml" },
    { label: "application/x-www-form-urlencoded" },
    { label: "application/octet-stream" },
    { label: "application/pdf" },
    { label: "application/zip" },
    { label: "application/graphql-response+json" },
    { label: "GraphQL" },
    { label: "text/plain" },
    { label: "text/html" },
    { label: "text/css" },
    { label: "text/javascript" },
    { label: "text/xml" },
    { label: "image/jpeg" },
    { label: "image/png" },
    { label: "image/gif" },
    { label: "image/svg+xml" },
    { label: "image/webp" },
    { label: "audio/mpeg" },
    { label: "audio/wav" },
    { label: "audio/ogg" },
    { label: "video/mp4" },
    { label: "video/webm" },
    { label: "video/ogg" },
    { label: "multipart/form-data" },
    {
      label:
        "multipart/form-data; boundary=----WebKitFormBoundary{{$timestamp}}",
    },
    { label: "chunked" },
    { label: "gzip" },
    { label: "deflate" },
    { label: "br" },
    { label: "identity" },
    { label: "compress" },
    { label: "x-gzip" },
    { label: "x-bzip2" },
    { label: "x-compress" },
    { label: "x-zip-compress" },
    { label: "x-zip" },
  ];

  const snippetsIn: SourceItem[] = [
    {
      label: "< {% %}",
      insertText: "< {%\n\t${0}\n%}\n",
      documentation: "Pre-request script",
    },
    {
      label: "< ",
      insertText: "< ${1:path/to/script.js|lua}",
      documentation: "Pre-request script file",
    },
    {
      label: "< {% %}",
      insertText: "< {%\n\t-- lua\n${0}\n%}\n",
      documentation: "Pre-request lua script",
    },
  ];

  const snippetsOut: SourceItem[] = [
    {
      label: ">>",
      insertText: ">> ",
      documentation: "Redirect output to file",
    },
    {
      label: ">>!",
      insertText: ">>! ",
      documentation: "Redirect output overwriting",
    },
    {
      label: "> {% %}",
      insertText: "> {%\n\t${0}\n%}\n",
      documentation: "Post-request script",
    },
    {
      label: "> ",
      insertText: "> ${1:path/to/script.js|lua}",
      documentation: "Post-request script file",
    },
    {
      label: "> {% %}",
      insertText: "> {%\n\t-- lua\n${0}\n%}\n",
      documentation: "Post-request lua script",
    },
  ];

  const scriptApi: SourceItem[] = [
    {
      label: "client.global.get",
      insertText: "client.global.get(${1:varName})$0",
      documentation: "Get a global variable",
    },
    {
      label: "client.global.set",
      insertText: "client.global.set(${1:varName}, ${2:value})$0",
      documentation: "Set a global variable",
    },
    {
      label: "client.responses",
      insertText: 'client.responses["${1:name}"]$0',
      documentation: "Previous responses",
    },
    {
      label: "client.log",
      insertText: "client.log(${1:message})$0",
      documentation: "Log message",
    },
    {
      label: "client.test",
      insertText: "client.test(${1:name}, ${2:fn})$0",
      documentation: "Define a test suite",
    },
    {
      label: "client.assert",
      insertText: "client.assert(${1:value}, ${2:message?})$0",
      documentation: "Checks if value is truthy",
    },
    {
      label: "client.isEmpty",
      insertText: "client.isEmpty()$0",
      documentation: "Check if globals are empty",
    },
    {
      label: "client.clear",
      insertText: "client.clear(${1:varName})$0",
      documentation: "Clear a global variable",
    },
    {
      label: "client.clearAll",
      insertText: "client.clearAll()$0",
      documentation: "Clear all global variables",
    },
    {
      label: "client.exit",
      insertText: "client.exit()$0",
      documentation: "Exit script",
    },

    {
      label: "request.variables.set",
      insertText: "request.variables.set(${1:varName}, ${2:value})$0",
      documentation: "Set a request variable",
    },
    {
      label: "request.variables.get",
      insertText: "request.variables.get(${1:varName})$0",
      documentation: "Get a request variable",
    },
    {
      label: "request.headers.all",
      insertText: "request.headers.all()$0",
      documentation: "Get all request headers",
    },
    {
      label: "request.headers.findByName",
      insertText: "request.headers.findByName(${1:name})$0",
      documentation: "Find request header by name",
    },
    {
      label: "request.body.getRaw",
      insertText: "request.body.getRaw()$0",
      documentation: "Get raw request body",
    },
    {
      label: "request.body.tryGetSubstituted",
      insertText: "request.body.tryGetSubstituted()$0",
      documentation: "Get substituted request body",
    },
    {
      label: "request.body.getComputed",
      insertText: "request.body.getComputed()$0",
      documentation: "Get computed request body",
    },
    {
      label: "request.environment.get",
      insertText: "request.environment.get(${1:varName})$0",
      documentation: "Get environment variable",
    },
    {
      label: "request.method",
      insertText: "request.method()$0",
      documentation: "Get request method",
    },
    {
      label: "request.url.getRaw",
      insertText: "request.url.getRaw()$0",
      documentation: "Get raw request URL",
    },
    {
      label: "request.url.tryGetSubstituted",
      insertText: "request.url.tryGetSubstituted()$0",
      documentation: "Get substituted request URL",
    },
    {
      label: "request.skip",
      insertText: "request.skip()$0",
      documentation: "Skip request",
    },
    {
      label: "request.replay",
      insertText: "request.replay()$0",
      documentation: "Replay request",
    },
    {
      label: "request.iteration",
      insertText: "request.iteration()$0",
      documentation: "Current replay count",
    },

    {
      label: "response.responseCode",
      insertText: "response.responseCode()$0",
      documentation: "Get response code",
    },
    {
      label: "response.status",
      insertText: "response.status()$0",
      documentation: "Get response status",
    },
    {
      label: "response.code",
      insertText: "response.code()$0",
      documentation: "Get request code",
    },
    {
      label: "response.url",
      insertText: "response.url()$0",
      documentation: "Get response URL",
    },
    {
      label: "response.body",
      insertText: "response.body()$0",
      documentation: "Get response body",
    },
    {
      label: "response.json",
      insertText: "response.json()$0",
      documentation: "Get response json",
    },
    {
      label: "response.errors",
      insertText: "response.errors()$0",
      documentation: "Get response errors",
    },
    {
      label: "response.headers.all",
      insertText: "response.headers.all()$0",
      documentation: "Get all response headers",
    },
    {
      label: "response.cookies",
      insertText: "response.cookies()$0",
      documentation: "Get response cookies",
    },
    {
      label: "response.headers",
      insertText: "response.headers()$0",
      documentation: "Get response headers",
    },
    {
      label: "response.headers_tbl",
      insertText: "response.headers_tbl()$0",
      documentation: "Get response headers table",
    },

    {
      label: "assert",
      insertText: "assert(${1:value}, ${2:message?})$0",
      documentation: "Checks if value is truthy",
    },
    {
      label: "assert.true",
      insertText: "assert.true(${1:value}, ${2:message?})$0",
      documentation: "Checks if value is true",
    },
    {
      label: "assert.false",
      insertText: "assert.false(${1:value}, ${2:message?})$0",
      documentation: "Checks if value is false",
    },
    {
      label: "assert.same",
      insertText: "assert.same(${1:value}, ${2:expected}, ${3:message?})$0",
      documentation: "Checks value equals expected",
    },
    {
      label: "assert.hasString",
      insertText:
        "assert.hasString(${1:value}, ${2:expected}, ${3:message?})$0",
      documentation: "Checks string contains substring",
    },
    {
      label: "assert.responseHas",
      insertText:
        "assert.responseHas(${1:key}, ${2:expected}, ${3:message?})$0",
      documentation: "Response has key with expected value",
    },
    {
      label: "assert.headersHas",
      insertText: "assert.headersHas(${1:key}, ${2:expected}, ${3:message?})$0",
      documentation: "Headers have key with expected value",
    },
    {
      label: "assert.bodyHas",
      insertText: "assert.bodyHas(${1:expected}, ${2:message?})$0",
      documentation: "Body contains expected string",
    },
    {
      label: "assert.jsonHas",
      insertText: "assert.jsonHas(${1:key}, ${2:expected}, ${3:message?})$0",
      documentation: "JSON has key with expected value",
    },
  ];

  const mk = (items: SourceItem[], description: string, kind = kindValue) =>
    items.map((item) =>
      makeItem({
        item,
        description,
        kind,
        sortText: "1.02", // keep parity with kulala.nvim's blink.cmp workaround
      }),
    );

  switch (sourceName) {
    case "methods":
      return mk(methods, "Method", kindValue);
    case "schemes":
      return mk(schemes, "Scheme", kindValue);
    case "commands":
      return mk(commands, "Command", kindValue);
    case "metadata":
      return mk(metadata, "Metadata", kindValue);
    case "curl":
      return mk(curl, "Curl", kindValue);
    case "grpc":
      return mk(grpc, "Grpc", kindValue);
    case "header_values":
      return mk(headerValues, "Header value", kindValue);
    case "snippets_in":
      return snippetsIn.map((item) =>
        makeItem({
          item,
          description: "Snippets",
          kind: kindSnippet,
          insertTextFormat: formatSnippet,
          sortText: "1.02",
        }),
      );
    case "snippets_out":
      return snippetsOut.map((item) =>
        makeItem({
          item,
          description: "Snippets",
          kind: kindSnippet,
          insertTextFormat: formatSnippet,
          sortText: "1.02",
        }),
      );
    case "scripts":
      return scriptApi.map((item) =>
        makeItem({
          item,
          description: "API",
          kind: kindSnippet,
          insertTextFormat: formatSnippet,
          sortText: "1.02",
        }),
      );
    default:
      return [];
  }
}
