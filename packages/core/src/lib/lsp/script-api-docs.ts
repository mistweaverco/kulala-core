import type { LspHover } from "./types";
import { templateVarCompletionRange } from "./completion-context";

export type ScriptApiDoc = {
  summary: string;
  signature: string;
  example?: string;
  notes?: string;
};

/** Snippet insert text → readable signature for hover/completion detail. */
export function snippetToSignature(insertText: string): string {
  return insertText
    .replace(/\$0/g, "")
    .replace(/\$\{(\d+)\|([^}]+)\}/g, (_, _n, choices) => {
      const first = choices.split(",")[0]?.trim();
      return first ?? choices;
    })
    .replace(/\$\{(\d+):([^}?]+)\?\}/g, "$2?")
    .replace(/\$\{(\d+):([^}]+)\}/g, "$2")
    .replace(/\$\d+/g, "")
    .trim();
}

export const SCRIPT_API_DOCS: Record<string, ScriptApiDoc> = {
  "$kulala.prompt": {
    summary:
      "Prompt for a request-scoped variable. Pauses the run until input is submitted (same flow as `// @prompt`). Returns the stored value on retry.",
    signature:
      '$kulala.prompt(label: string, varName: string, opts?: { type?: "text" | "password" | "url" })',
    example:
      '$kulala.prompt("Password?", "keepassxc_password", { type: "password" });',
    notes:
      'In Lua, use `_G["$kulala"].prompt(...)` because `$` is not a valid identifier.',
  },
  "$kulala.request.skip": {
    summary: "Skip sending the current request. Pre-request scripts only.",
    signature: "$kulala.request.skip()",
    notes: 'In Lua: `_G["$kulala"].request.skip()`.',
  },
  "$kulala.request.replay": {
    summary:
      "Re-run the current request (pre- and post-request scripts). Replays are capped per request.",
    signature: "$kulala.request.replay()",
    notes: 'In Lua: `_G["$kulala"].request.replay()`.',
  },
  "$kulala.runRequest": {
    summary:
      "Run another named HTTP request from the current or an external `.http` file and return its response (Bruno-style request chaining).",
    signature:
      "$kulala.runRequest(name: string, filePath?: string): Promise<ScriptResponse>",
    example:
      'const res = await $kulala.runRequest("Login");\nclient.global.set("authToken", res.body.access_token);',
    notes:
      'Lookup uses `###` block names. Without `filePath`, imported files are searched first. In Lua: `local res = _G["$kulala"].runRequest("Login")` (await the returned promise if your runtime supports it).',
  },
  "$kulala.client.global.headers.set": {
    summary:
      "Set a default HTTP header persisted across runs (merged into outgoing requests unless overridden). Case-insensitive header names.",
    signature:
      "$kulala.client.global.headers.set(headerName: string, headerValue: string)",
    example: '$kulala.client.global.headers.set("X-Kulala", "Family");',
    notes:
      'Configured via `$kulalaShared` / `$kulalaDefaultHeaders` in `http-client.env.json`. In Lua: `_G["$kulala"].client.global.headers.set(...)`.',
  },
  "$kulala.client.global.headers.get": {
    summary: "Get a persisted default header value by name (case-insensitive).",
    signature: "$kulala.client.global.headers.get(headerName: string)",
    example: 'const v = $kulala.client.global.headers.get("X-Kulala");',
    notes: 'In Lua: `_G["$kulala"].client.global.headers.get(...)`.',
  },
  "$kulala.client.global.headers.clear": {
    summary: "Remove a persisted default header by name (case-insensitive).",
    signature: "$kulala.client.global.headers.clear(headerName: string)",
    example: '$kulala.client.global.headers.clear("X-Kulala");',
    notes: 'In Lua: `_G["$kulala"].client.global.headers.clear(...)`.',
  },
  "client.global.get": {
    summary:
      "Get a global variable. Values persist across script runs and Neovim restarts.",
    signature: "client.global.get(varName: string)",
    example: 'client.global.get("SOME_TOKEN");',
  },
  "client.global.set": {
    summary:
      "Set a global variable. Values persist across script runs and Neovim restarts.",
    signature: "client.global.set(varName: string, value: unknown)",
    example: 'client.global.set("SOME_TOKEN", "123");',
  },
  "client.log": {
    summary: "Log arbitrary data to the Kulala output buffer.",
    signature: "client.log(...args: unknown[])",
    example: 'client.log("Hello", response.status);',
  },
  "client.test": {
    summary:
      "Define a named test suite with a callback. See Kulala testing docs for reporting.",
    signature: "client.test(name: string, fn: () => void)",
  },
  "client.assert": {
    summary: "Assert that a value is truthy; fails the test when not.",
    signature: "client.assert(value: unknown, message?: string)",
  },
  "client.isEmpty": {
    summary: "Returns whether no global variables are defined.",
    signature: "client.isEmpty(): boolean",
    example: "if (client.isEmpty()) client.log('No globals');",
  },
  "client.global.clear": {
    summary: "Remove a single variable from global storage.",
    signature: "client.global.clear(varName: string)",
    example: 'client.global.clear("SOME_TOKEN");',
  },
  "client.global.clearAll": {
    summary: "Remove all global variables.",
    signature: "client.global.clearAll()",
    example: "client.global.clearAll();",
  },
  "client.exit": {
    summary: "Stop executing the current response handler script.",
    signature: "client.exit()",
    example: "client.exit();",
  },
  "request.variables.set": {
    summary:
      "Set a request-scoped variable (available for the duration of the current request only).",
    signature: "request.variables.set(varName: string, value: unknown)",
    example: 'request.variables.set("TOKEN", "abc");',
  },
  "request.variables.get": {
    summary: "Get a request-scoped variable.",
    signature: "request.variables.get(varName: string)",
    example: 'request.variables.get("TOKEN");',
  },
  "request.headers.all": {
    summary: "List all request headers as header objects.",
    signature: "request.headers.all(): Header[]",
  },
  "request.headers.findByName": {
    summary: "Find a request header by name (case-insensitive).",
    signature: "request.headers.findByName(name: string): Header | undefined",
  },
  "request.body.getRaw": {
    summary:
      "Request body as written in the file (`undefined` if none). Variables appear as placeholders, not substituted values.",
    signature: "request.body.getRaw(): string | undefined",
    example: "client.log(request.body.getRaw());",
  },
  "request.body.tryGetSubstituted": {
    summary:
      "Request body with `{{variables}}` substituted (`undefined` if none).",
    signature: "request.body.tryGetSubstituted(): string | undefined",
  },
  "request.environment.get": {
    summary: "Read a variable from the active HTTP environment file.",
    signature: "request.environment.get(varName: string): string | null",
  },
  "request.method": {
    summary: "HTTP method of the current request.",
    signature: "request.method: string",
  },
  "request.url.getRaw": {
    summary:
      "Request URL as written in the file (may contain `{{variables}}`).",
    signature: "request.url.getRaw(): string",
  },
  "request.url.tryGetSubstituted": {
    summary: "Request URL with variables substituted.",
    signature: "request.url.tryGetSubstituted(): string",
  },
  "response.contentType.mimeType": {
    summary: "Content-Type of the response, if any.",
    signature: "response.contentType.mimeType: string | undefined",
  },
  "response.contentType.charset": {
    summary: "Content-Type of the response, if any.",
    signature: "response.contentType.charset: string | undefined",
  },
  "response.status": {
    summary: "HTTP status code of the response.",
    signature: "response.status: number",
  },
  "response.body": {
    summary:
      "Response body as a string, or parsed JSON when the response is JSON.",
    signature: "response.body: string | object",
    example: "client.log(response.body);",
  },
  "response.headers.valueOf": {
    summary:
      "Retrieves the first value of the headerName response header or null if the headerName response header does not exist.",
    signature: "response.headers.valueOf(headerName: string): string | null",
    example: 'response.headers.valueOf("Content-Type");',
  },
  "response.headers.valuesOf": {
    summary:
      "Retrieves the array containing all values of the headerName response header. Returns an empty array if the headerName response header does not exist.",
    signature: "response.headers.valuesOf(headerName: string): string[]",
    example: 'response.headers.valuesOf("Content-Type");',
  },
};

const SCRIPT_API_LABELS = Object.keys(SCRIPT_API_DOCS).sort(
  (a, b) => b.length - a.length,
);

export function scriptApiDocumentationMarkdown(
  label: string,
  fallback?: string,
): string | undefined {
  const doc = SCRIPT_API_DOCS[label];
  if (!doc) {
    if (!fallback) return undefined;
    return `### \`${label}\`\n\n${fallback}`;
  }
  let md = `### \`${label}\`\n\n${doc.summary}\n\n\`\`\`javascript\n${doc.signature}\n\`\`\``;
  if (doc.notes) md += `\n\n${doc.notes}`;
  if (doc.example) {
    md += `\n\n**Example:**\n\`\`\`javascript\n${doc.example}\n\`\`\``;
  }
  return md;
}

export function scriptApiCompletionDetail(
  label: string,
  insertText?: string,
): string {
  const doc = SCRIPT_API_DOCS[label];
  if (doc) return doc.signature;
  if (insertText) return snippetToSignature(insertText);
  return label;
}

const SCRIPT_SYMBOL_RE =
  /(\$kulala(?:\.[\w]+)*|(?:client|request|response|assert)(?:\.[\w]+)*)/g;

/** Script / `$kulala` token immediately before the cursor (includes `$`). */
const COMPLETION_PREFIX_RE = /[$\w.]+$/;

function longestSuffixPrefixMatch(before: string, candidate: string): number {
  const maxLen = Math.min(before.length, candidate.length);
  for (let len = maxLen; len > 0; len--) {
    const suffix = before.slice(before.length - len);
    if (candidate.startsWith(suffix)) return len;
  }
  return 0;
}

/**
 * 0-based range of text to replace when accepting a completion item.
 * Prefers the longest typed suffix that matches the start of `newText` (covers
 * `> ` → `> {%` snippets), then `{{var` template identifiers, then word tokens.
 * @param column1 1-based cursor column (Vim); the character under the cursor is included.
 */
export function completionReplaceRange(
  line: string,
  column1: number,
  newText: string,
  label?: string,
): { startCol0: number; endCol0: number; closingSuffix?: string } {
  const endCol0 = Math.max(0, Math.min(column1, line.length));
  const before = line.slice(0, endCol0);

  const templateRange = templateVarCompletionRange(line, column1);
  if (templateRange) {
    return {
      startCol0: templateRange.startCol0,
      endCol0: templateRange.endCol0,
      closingSuffix: templateRange.addClosingBraces ? "}}" : undefined,
    };
  }

  let matchLen = longestSuffixPrefixMatch(before, newText);
  if (matchLen === 0 && label && label !== newText) {
    matchLen = longestSuffixPrefixMatch(before, label);
  }
  if (matchLen > 0) {
    return { startCol0: endCol0 - matchLen, endCol0 };
  }

  const templateMatch = before.match(/\{\{([^}]*)$/);
  if (templateMatch) {
    const prefix = templateMatch[1] ?? "";
    return { startCol0: endCol0 - prefix.length, endCol0 };
  }

  const word = before.match(COMPLETION_PREFIX_RE)?.[0] ?? "";
  return { startCol0: endCol0 - word.length, endCol0 };
}

/**
 * Word/token prefix at the cursor (used for filtering, not snippet replace ranges).
 * @param column1 1-based cursor column (Vim); the character under the cursor is included.
 */
export function completionPrefixAtCursor(
  line: string,
  column1: number,
): { prefix: string; startCol0: number; endCol0: number } {
  const endCol0 = Math.max(0, Math.min(column1, line.length));
  const before = line.slice(0, endCol0);
  const prefix = before.match(COMPLETION_PREFIX_RE)?.[0] ?? "";
  return {
    prefix,
    startCol0: endCol0 - prefix.length,
    endCol0,
  };
}

export function completionTextEdit(
  line1: number,
  startCol0: number,
  endCol0: number,
  newText: string,
): {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
} {
  return {
    range: {
      start: { line: line1 - 1, character: Math.max(0, startCol0) },
      end: { line: line1 - 1, character: Math.max(0, endCol0) },
    },
    newText,
  };
}

export function scriptSymbolAtCursor(
  line: string,
  column1: number,
): string | null {
  const col0 = Math.max(0, column1 - 1);
  let best: string | null = null;
  for (const match of line.matchAll(SCRIPT_SYMBOL_RE)) {
    const symbol = match[0];
    const start = match.index ?? 0;
    const end = start + symbol.length;
    if (col0 >= start && col0 < end) return symbol;
    if (col0 === end) best = symbol;
  }
  return best;
}

export function resolveScriptApiLabel(symbol: string): string | null {
  if (!symbol) return null;
  if (symbol in SCRIPT_API_DOCS) return symbol;

  let best: string | null = null;
  for (const label of SCRIPT_API_LABELS) {
    if (label.startsWith(symbol) || symbol.startsWith(label)) {
      if (!best || label.length > best.length) best = label;
    }
  }
  return best;
}

export function scriptApiHoverForLabel(label: string): LspHover | null {
  const md = scriptApiDocumentationMarkdown(label);
  if (!md) return null;
  return { contents: { kind: "markdown", value: md } };
}
