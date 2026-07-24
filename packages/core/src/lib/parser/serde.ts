import type { KulalaDocument } from "./types/document";
import type { KulalaBlock } from "./types/block";
import type { KulalaDirective } from "./types/directive";
import type {
  KulalaHeaderSectionEntry,
  KulalaRequestLinePart,
} from "./types/request";
import type { KulalaOperator } from "./types/operator";
import type { KulalaScript } from "./types/script";
import { getDocument } from "./parser";
import { dirname, isAbsolute, relative, resolve } from "path";

export type KulalaHttpSerdeSerializeOptions = {
  /**
   * When false (default), only serializes the first `nativeBlockCount` blocks (the blocks belonging
   * to the current file). When true, serializes all blocks in `doc.blocks` (including imported/run-expanded).
   */
  includeExpandedBlocks?: boolean;
  /** When true, emit the original source body text instead of re-serializing parsed bodies. */
  preserveBodyText?: boolean;
};

export async function deserializeHttp(
  content: string,
  filepath?: string,
): Promise<KulalaDocument> {
  return await getDocument(content, filepath);
}

function serializeOperator(op: KulalaOperator): string {
  const args =
    op.args === undefined || op.args === "" ? "" : ` ${String(op.args)}`;
  return `# @${op.name}${args}`;
}

function hasPreambleBeforeRequest(block: KulalaBlock): boolean {
  return (
    (block.preamble?.length ?? 0) > 0 ||
    (block.preambleVariables !== undefined &&
      Object.keys(block.preambleVariables).length > 0)
  );
}

function serializeDirective(d: KulalaDirective): string {
  if (d.type === "import") return `import ${d.filepath}`;
  if (d.variableOverrides && Object.keys(d.variableOverrides).length > 0) {
    const overrides = Object.entries(d.variableOverrides)
      .map(([k, v]) => `@${k}=${v}`)
      .join(", ");
    return `run ${d.target} (${overrides})`;
  }
  return `run ${d.target}`;
}

function maybeQuoteIfHasSpaces(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function toDocRelativePath(
  pathFromScript: string,
  docFilepath?: string,
): string {
  if (!docFilepath) return pathFromScript;
  const docDir = dirname(docFilepath);
  const abs = isAbsolute(pathFromScript)
    ? pathFromScript
    : resolve(process.cwd(), pathFromScript);
  let rel = relative(docDir, abs);
  if (rel === "") rel = ".";
  if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
  return rel;
}

function serializeScript(script: KulalaScript, docFilepath?: string): string[] {
  const marker = script.type === "preRequest" ? "<" : ">";
  if (script.source === "file" && script.filepath) {
    return [`${marker} ${toDocRelativePath(script.filepath, docFilepath)}`];
  }
  const lang = script.langExplicit && script.lang ? ` lang=${script.lang}` : "";
  return [`${marker} {%${lang}`.trimEnd(), ...script.content.split("\n"), "%}"];
}

function pushScriptsWithBlankLines(
  target: string[],
  scripts: KulalaScript[],
  docFilepath?: string,
) {
  for (let i = 0; i < scripts.length; i++) {
    if (i > 0) target.push("");
    target.push(...serializeScript(scripts[i]!, docFilepath));
  }
}

function serializeRequestLineParts(
  method: string,
  parts: KulalaRequestLinePart[],
  httpVersion?: string,
  httpVersionInline?: boolean,
): string[] {
  const lines: string[] = [];
  const firstUrl = parts.find((p) => p.type === "url");
  if (!firstUrl || firstUrl.type !== "url") {
    // Fallback: caller should handle; keep output parseable.
    return [`${method} /${httpVersion ? ` ${httpVersion}` : ""}`.trim()];
  }
  let firstUrlEmitted = false;
  for (const p of parts) {
    if (p.type === "url") {
      if (!firstUrlEmitted) {
        lines.push(`${method} ${p.line}`.trimEnd());
        firstUrlEmitted = true;
      } else {
        lines.push(`  ${p.line}`.trimEnd());
      }
    } else {
      const ws = p.comment.leadingWhitespace ?? "  ";
      lines.push(`${ws}# ${p.comment.content}`.trimEnd());
    }
  }
  if (httpVersion) {
    if (httpVersionInline && lines.length > 1) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${httpVersion}`;
    } else {
      lines.push(`  ${httpVersion}`);
    }
  }
  return lines;
}

function serializeHeaderSection(section: KulalaHeaderSectionEntry[]): string[] {
  const out: string[] = [];
  for (const entry of section) {
    if (entry.type === "comment") {
      out.push(`# ${entry.comment.content}`);
    } else {
      out.push(
        entry.value === undefined
          ? `${entry.name}:`
          : `${entry.name}: ${entry.value}`,
      );
    }
  }
  return out;
}

function isBodyFromFile(body: unknown): body is { __bodyFromFile: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    "__bodyFromFile" in body &&
    typeof (body as { __bodyFromFile?: unknown }).__bodyFromFile === "string"
  );
}

function isGraphQLBody(body: unknown): body is {
  query: string;
  variables?: Record<string, unknown>;
  variablesSourceText?: string;
} {
  return (
    typeof body === "object" &&
    body !== null &&
    "query" in body &&
    typeof (body as { query?: unknown }).query === "string"
  );
}

function serializeBody(
  method: string,
  body: unknown,
  sourceBodyText?: string,
  preserveBodyText?: boolean,
): string[] {
  if (preserveBodyText && sourceBodyText !== undefined) {
    return sourceBodyText.length ? sourceBodyText.split("\n") : [];
  }
  if (body === undefined || body === null) return [];
  if (typeof body === "string") return body.length ? body.split("\n") : [];

  if (isBodyFromFile(body)) {
    const b = body as {
      __bodyFromFile: string;
      __graphqlVariablesSuffix?: string;
    };
    const out = [`< ${maybeQuoteIfHasSpaces(b.__bodyFromFile)}`];
    if (method === "GRAPHQL" && b.__graphqlVariablesSuffix) {
      out.push("");
      out.push(...b.__graphqlVariablesSuffix.trimEnd().split("\n"));
    }
    return out;
  }

  if (method === "GRAPHQL" && isGraphQLBody(body)) {
    const gql = body;
    const out = gql.query.trimEnd().split("\n");
    if (gql.variablesSourceText !== undefined) {
      out.push("");
      out.push(...gql.variablesSourceText.split("\n"));
    } else if (gql.variables !== undefined) {
      out.push("");
      out.push(JSON.stringify(gql.variables, null, 2));
    }
    return out;
  }

  return [JSON.stringify(body, null, 2)];
}

function serializeBlock(
  block: KulalaBlock,
  docFilepath?: string,
  options: KulalaHttpSerdeSerializeOptions = {},
): string[] {
  const lines: string[] = [];
  lines.push(`### ${block.name}`.trimEnd());
  // One blank line after each block separator.
  lines.push("");

  // Preserve block-local `run ...` directives (the parser stores them on private fields).
  // If a block contained only a `run` statement, parsing may replace its request/scripts with the referenced block.
  // To round-trip the *source file*, prefer serializing the run directive instead of the expanded request.
  const runDirective =
    (
      block as unknown as {
        __runDirective?: KulalaDirective;
        __blockRunDirective?: KulalaDirective;
      }
    ).__runDirective ??
    (
      block as unknown as {
        __runDirective?: KulalaDirective;
        __blockRunDirective?: KulalaDirective;
      }
    ).__blockRunDirective;
  if (runDirective?.type === "run") {
    // Keep any preamble/scripts that were authored in this block (they are preserved on the block),
    // then emit the directive and stop (do not serialize expanded request).

    // Pre-request scripts
    const preScripts = [...(block.scripts?.preRequest ?? [])].sort(
      (a, b) => a.lineNumber - b.lineNumber,
    );
    pushScriptsWithBlankLines(lines, preScripts, docFilepath);
    if (preScripts.length > 0) lines.push("");

    // Preamble @vars (no per-line ordering preserved in model)
    if (block.preambleVariables) {
      const entries = Object.entries(block.preambleVariables).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [k, v] of entries) {
        lines.push(`@${k} = ${v}`);
      }
    }

    // Preamble operators/comments in order
    for (const entry of block.preamble ?? []) {
      if ("name" in entry) {
        lines.push(serializeOperator(entry));
      } else {
        lines.push(`# ${entry.content}`);
      }
    }

    lines.push(serializeDirective(runDirective));

    // Post-request scripts
    const postScripts = [...(block.scripts?.postRequest ?? [])].sort(
      (a, b) => a.lineNumber - b.lineNumber,
    );
    if (postScripts.length) {
      lines.push("");
      pushScriptsWithBlankLines(lines, postScripts, docFilepath);
    }

    return lines;
  }

  // Pre-request scripts
  const preScripts = [...(block.scripts?.preRequest ?? [])].sort(
    (a, b) => a.lineNumber - b.lineNumber,
  );
  pushScriptsWithBlankLines(lines, preScripts, docFilepath);
  if (preScripts.length > 0) lines.push("");

  // Preamble @vars (no per-line ordering preserved in model)
  if (block.preambleVariables) {
    const entries = Object.entries(block.preambleVariables).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [k, v] of entries) {
      lines.push(`@${k} = ${v}`);
    }
  }

  // Preamble operators/comments in order
  for (const entry of block.preamble ?? []) {
    if ("name" in entry) {
      lines.push(serializeOperator(entry));
    } else {
      lines.push(`# ${entry.content}`);
    }
  }

  if (hasPreambleBeforeRequest(block)) {
    lines.push("");
  }

  // Comment-only / operator-only blocks have no request line - do not invent `GET /`.
  if (block.hasRequest === false) {
    const postScriptsOnly = [...(block.scripts?.postRequest ?? [])].sort(
      (a, b) => a.lineNumber - b.lineNumber,
    );
    if (postScriptsOnly.length) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      pushScriptsWithBlankLines(lines, postScriptsOnly, docFilepath);
    }
    return lines;
  }

  // Request line(s)
  if (block.request.requestLineParts && block.request.requestLineParts.length) {
    lines.push(
      ...serializeRequestLineParts(
        block.request.method,
        block.request.requestLineParts,
        block.request.httpVersion,
        block.request.httpVersionInline,
      ),
    );
  } else {
    lines.push(
      `${block.request.method} ${block.request.url}${
        block.request.httpVersion ? ` ${block.request.httpVersion}` : ""
      }`.trimEnd(),
    );
  }

  // Headers
  lines.push(...serializeHeaderSection(block.request.headerSection ?? []));

  // Body
  const bodyLines = serializeBody(
    block.request.method,
    block.request.body,
    block.request.sourceBodyText,
    options.preserveBodyText,
  );
  const trailingComments = block.trailingComments ?? [];
  const postScripts = [...(block.scripts?.postRequest ?? [])].sort(
    (a, b) => a.lineNumber - b.lineNumber,
  );
  const hasAfterHeaders =
    bodyLines.length > 0 ||
    trailingComments.length > 0 ||
    block.request.responseRedirect !== undefined ||
    postScripts.length > 0;
  // Only emit the blank line separator when something follows.
  if (hasAfterHeaders) {
    lines.push("");
    lines.push(...bodyLines);
  }

  if (trailingComments.length) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    for (const comment of trailingComments) {
      lines.push(`# ${comment.content}`.trimEnd());
    }
  }

  // Response redirect
  if (block.request.responseRedirect) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    const rr = block.request.responseRedirect;
    lines.push(`${rr.overwrite ? ">>!" : ">>"} ${rr.filePath}`.trimEnd());
  }

  // Post-request scripts
  if (postScripts.length) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    pushScriptsWithBlankLines(lines, postScripts, docFilepath);
  }

  return lines;
}

export function serializeHttp(
  doc: KulalaDocument,
  options: KulalaHttpSerdeSerializeOptions = {},
): string {
  const includeExpandedBlocks = options.includeExpandedBlocks === true;
  const blocks = includeExpandedBlocks
    ? doc.blocks
    : doc.blocks.slice(0, doc.nativeBlockCount ?? doc.blocks.length);

  const lines: string[] = [];

  // File header vars
  if (doc.fileHeaderVariables) {
    const entries = Object.entries(doc.fileHeaderVariables).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [k, v] of entries) {
      lines.push(`@${k} = ${v}`);
    }
  }

  // File header operators
  const fileOps = doc.fileHeaderOperators ?? [];
  if (fileOps.length) {
    for (const op of [...fileOps].sort((a, b) => a.lineNumber - b.lineNumber)) {
      lines.push(serializeOperator(op));
    }
  } else if (doc.vscodeRestclientCompat) {
    lines.push("# @kulala-vscode-restclient-compat");
  }

  // File header comments (including commented-out requests before the first ###)
  const fileComments = doc.fileHeaderComments ?? [];
  if (fileComments.length) {
    for (const comment of [...fileComments].sort(
      (a, b) => a.lineNumber - b.lineNumber,
    )) {
      lines.push(`# ${comment.content}`.trimEnd());
    }
  }

  // Directives
  const directives = doc.directives ?? [];
  if (directives.length) {
    for (const d of [...directives].sort((a, b) => a.lineNumber - b.lineNumber))
      lines.push(serializeDirective(d));
  }

  if (lines.length) lines.push("");

  // Blocks
  for (const [i, b] of blocks.entries()) {
    // One blank line between blocks.
    if (i > 0) lines.push("");
    lines.push(...serializeBlock(b, doc.filepath, options));
  }

  const out = lines.join("\n").replace(/\s+$/g, "");
  return out.length ? out + "\n" : "";
}
