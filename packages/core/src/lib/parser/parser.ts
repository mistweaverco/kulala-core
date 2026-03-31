import type { KulalaDocument } from "./types";
import type {
  KulalaBlock,
  KulalaBlockLineType,
  KulalaSeenBlockLineTypes,
} from "./types/block";

import { pad } from "./lib/helpers";
import type { KulalaOperator } from "./types/operator";
import { getOperator } from "./operator";
import type { KulalaError } from "./types/error";
import type { KulalaScript } from "./types/script";
import { getInlineScriptConsumedLineCount, getScript } from "./script";
import { getHeader } from "./header";
import { getBody } from "./body";
import type { KulalaHeader } from "./types/header";
import { getComment } from "./comment";
import { getRequest } from "./request";
import type { KulalaRequestBody } from "./types/body";
import {
  parseImportDirective,
  parseRunDirective,
  isDirective,
} from "./directive";
import {
  extractFileHeaderAtVariables,
  parseAtVariableLine,
} from "./at-variables";
import type { KulalaDirective, KulalaRunDirective } from "./types/directive";
import { resolve, dirname } from "path";
const blockRegex = /###(.*?)\n([\s\S]+?)(?=###|$)/g;
const nameRegex = /### (.+?)\n/;

type BlockWithRunDirective = KulalaBlock & {
  __runDirective?: KulalaRunDirective;
  __blockRunDirective?: KulalaRunDirective;
};

const getBlockName = (rawBlock: string, idx: number): string => {
  return rawBlock.match(nameRegex)?.[1] || `REQUEST_${pad(idx + 1, 3, "0")}`;
};

const getLineType = (
  line: string,
  lineIdx: number,
  seenBlockTypes: KulalaSeenBlockLineTypes,
): KulalaBlockLineType => {
  if (lineIdx === 0) return { name: "name", lineNumber: lineIdx };
  if (line.startsWith("###")) return { name: "name", lineNumber: lineIdx };
  // Redirect response (>> path / >>! path) must be checked before generic body
  if (
    seenBlockTypes.has("afterHeaders") &&
    (line.startsWith(">>!") || line.startsWith(">>"))
  ) {
    return { name: "responseRedirect", lineNumber: lineIdx };
  }
  // Post-response script (`> {%` / `> path`) must run before generic body (which also matches `> ...`).
  if (seenBlockTypes.has("afterHeaders") && line.startsWith("> ")) {
    return { name: "postRequestScript", lineNumber: lineIdx };
  }
  // Body line (including JetBrains "< path" body-from-file) must be checked before "< " → preRequestScript
  if (
    seenBlockTypes.has("request") &&
    seenBlockTypes.has("afterHeaders") &&
    !seenBlockTypes.has("afterBody") &&
    !seenBlockTypes.has("postRequestScript")
  ) {
    return { name: "body", lineNumber: lineIdx };
  }
  if (line.startsWith("< ")) {
    return { name: "preRequestScript", lineNumber: lineIdx };
  }
  if (!seenBlockTypes.has("request") && line.trim().startsWith("@")) {
    if (parseAtVariableLine(line) !== undefined) {
      return { name: "docVariable", lineNumber: lineIdx };
    }
  }
  if (line.startsWith("# @")) return { name: "operator", lineNumber: lineIdx };
  if (line.startsWith("#")) return { name: "comment", lineNumber: lineIdx };
  if (
    line.match(
      /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT|GRAPHQL) /,
    )
  ) {
    return { name: "request", lineNumber: lineIdx };
  }
  if (
    seenBlockTypes.has("request") &&
    !seenBlockTypes.has("body") &&
    /^\s/.test(line)
  ) {
    return { name: "requestContinuation", lineNumber: lineIdx };
  }
  if (
    seenBlockTypes.has("request") &&
    !seenBlockTypes.has("afterHeaders") &&
    !seenBlockTypes.has("body") &&
    line.includes(": ")
  ) {
    return { name: "headers", lineNumber: lineIdx };
  }
  if (seenBlockTypes.has("request") && line.trim() === "") {
    return { name: "afterHeaders", lineNumber: lineIdx };
  }
  if (line.trim() === "" && seenBlockTypes.has("body")) {
    return { name: "afterBody", lineNumber: lineIdx };
  }
  return { name: "unknown", lineNumber: lineIdx };
};

const isError = (obj: unknown): obj is KulalaError => {
  return typeof obj === "object" && obj !== null && "errorMessage" in obj;
};

const getParsedBlock = async (
  rawBlock: string,
  idx: number,
  position: { start: number; end: number },
  filepath?: string,
): Promise<KulalaBlock> => {
  let lineIdx = 0;
  let lineType: KulalaBlockLineType = { name: "name", lineNumber: lineIdx };
  let header: KulalaHeader | KulalaError;
  let operator: KulalaOperator | KulalaError;
  let script: KulalaScript | KulalaError;
  let body: KulalaRequestBody | KulalaError;
  const seenBlockTypes: KulalaSeenBlockLineTypes = new Set<
    KulalaBlockLineType["name"]
  >();
  const lines = rawBlock.split("\n");
  const name = getBlockName(rawBlock, idx);
  const result: KulalaBlock = {
    name,
    errors: [],
    preamble: [],
    comments: [],
    operators: [],
    request: {
      method: "GET",
      url: "/",
      headerSection: [],
    },
    scripts: {
      preRequest: [],
      postRequest: [],
    },
    position,
  };
  while (lineIdx < lines.length) {
    const line = lines[lineIdx];
    lineType = getLineType(line, lineIdx, seenBlockTypes);
    if (!seenBlockTypes.has(lineType.name)) {
      seenBlockTypes.add(lineType.name);
    }

    // Check for run directive inside block (before request is parsed)
    if (!seenBlockTypes.has("request") && isDirective(line)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("run ")) {
        const runDirective = parseRunDirective(line, lineIdx);
        if (!isError(runDirective)) {
          // Store run directive on block for later processing
          (result as unknown as BlockWithRunDirective).__blockRunDirective =
            runDirective;
        } else {
          result.errors.push(runDirective);
        }
        lineIdx++;
        continue;
      }
    }

    switch (lineType.name) {
      case "name":
        break;
      case "headers": {
        header = getHeader(line, lineIdx);
        if (isError(header)) {
          result.errors.push(header);
          break;
        }
        result.request.headerSection.push({
          type: "header",
          name: header.name,
          value: header.value,
        });
        break;
      }
      case "comment":
        if (!seenBlockTypes.has("request")) {
          const comment = getComment(line, lineIdx);
          result.preamble.push(comment);
          result.comments.push(comment);
        } else {
          result.request.headerSection.push({
            type: "comment",
            comment: getComment(line, lineIdx),
          });
        }
        break;
      case "docVariable": {
        const parsed = parseAtVariableLine(line);
        if (parsed) {
          if (!result.preambleVariables) result.preambleVariables = {};
          result.preambleVariables[parsed.name] = parsed.value;
        }
        break;
      }
      case "request": {
        const [requestResult, consumed] = getRequest(lines, lineIdx);
        if (isError(requestResult)) {
          result.errors.push(requestResult);
          lineIdx += 1;
          break;
        }
        result.request = requestResult;
        lineIdx += consumed - 1;
        break;
      }
      case "requestContinuation":
        break;
      case "operator":
        operator = getOperator(line, lineIdx);
        if (isError(operator)) {
          result.errors.push(operator);
          break;
        }
        result.preamble.push(operator);
        result.operators.push(operator);
        break;
      case "body":
        if (result.request.body) break;
        body = await getBody(lines, lineIdx, result.request.method);
        if (isError(body)) {
          result.errors.push(body);
          break;
        }
        result.request.body = body.content;
        break;
      case "responseRedirect": {
        const overwrite = line.startsWith(">>!");
        const path = (
          line.startsWith(">>!") ? line.slice(3) : line.slice(2)
        ).trim();
        if (path) {
          result.request.responseRedirect = { filePath: path, overwrite };
        }
        break;
      }
      case "preRequestScript":
      case "postRequestScript":
        script = await getScript(line, lines, lineIdx, filepath);
        if (isError(script)) {
          result.errors.push(script);
          break;
        }
        result.scripts[script.type].push(script);
        lineIdx += getInlineScriptConsumedLineCount(line, lines, lineIdx) - 1;
        break;
      default:
        // Treat unknown, non-empty lines as parse errors.
        if (line.trim() !== "") {
          const beforeRequest = !seenBlockTypes.has("request");
          result.errors.push({
            errorMessage: beforeRequest
              ? `Invalid request block line before request: "${line}"`
              : `Unrecognized request block line: "${line}"`,
            lineNumber: lineIdx,
          });
        }
        break;
    }
    lineIdx++;
  }
  return result as KulalaBlock;
};

/**
 * Extract directives (import/run) from the top of the file, before blocks.
 */
function extractDirectives(content: string): {
  directives: KulalaDirective[];
  contentWithoutDirectives: string;
  errors: KulalaError[];
  directiveLinesRemoved: number;
} {
  const lines = content.split("\n");
  const directives: KulalaDirective[] = [];
  const errors: KulalaError[] = [];
  let directiveEndIdx = 0;

  // Find directives at the top (before first block)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Stop at first block marker
    if (trimmed.startsWith("###")) {
      break;
    }

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (isDirective(line)) {
      directiveEndIdx = i + 1;
      if (trimmed.startsWith("import ")) {
        const result = parseImportDirective(line, i);
        if ("errorMessage" in result) {
          errors.push(result);
        } else {
          directives.push(result);
        }
      } else if (trimmed.startsWith("run ")) {
        const result = parseRunDirective(line, i);
        if ("errorMessage" in result) {
          errors.push(result);
        } else {
          directives.push(result);
        }
      }
    }
  }

  // Remove directive lines from content
  const contentWithoutDirectives =
    directiveEndIdx > 0 ? lines.slice(directiveEndIdx).join("\n") : content;

  return {
    directives,
    contentWithoutDirectives,
    errors,
    directiveLinesRemoved: directiveEndIdx,
  };
}

function attachSourceFileHeaderVars(
  blockList: KulalaBlock[],
  vars: Record<string, string>,
): KulalaBlock[] {
  if (Object.keys(vars).length === 0) return blockList;
  return blockList.map((b) => ({ ...b, sourceFileHeaderVariables: vars }));
}

const getBlocks = async (
  content: string,
  filepath?: string,
): Promise<KulalaBlock[]> => {
  const blocks: KulalaBlock[] = [];
  const rawBlocks = content.matchAll(blockRegex);
  for (const [idx, rawBlock] of Array.from(rawBlocks).entries()) {
    const start = content.substring(0, rawBlock.index).split("\n").length;
    const end = start + rawBlock[0].split("\n").length - 2;
    const position = { start, end };
    blocks.push(await getParsedBlock(rawBlock[0], idx, position, filepath));
  }
  return blocks;
};

/**
 * Resolve a file path relative to the current file.
 */
async function resolveImportPath(
  importPath: string,
  currentFilepath?: string,
): Promise<string> {
  if (currentFilepath) {
    const baseDir = dirname(currentFilepath);
    return resolve(baseDir, importPath);
  }
  return resolve(process.cwd(), importPath);
}

/**
 * Load and parse an imported file.
 */
async function loadImportedFile(
  importPath: string,
  currentFilepath?: string,
  visitedFiles: Set<string> = new Set(),
): Promise<KulalaDocument | KulalaError> {
  const resolvedPath = await resolveImportPath(importPath, currentFilepath);
  const normalizedPath = resolve(resolvedPath);

  // Prevent circular imports
  if (visitedFiles.has(normalizedPath)) {
    return {
      errorMessage: `Circular import detected: ${normalizedPath}`,
      lineNumber: 0,
    };
  }

  visitedFiles.add(normalizedPath);

  try {
    const file = Bun.file(resolvedPath);
    if (!(await file.exists())) {
      return {
        errorMessage: `Imported file not found: ${resolvedPath}`,
        lineNumber: 0,
      };
    }
    const content = await file.text();
    return await getDocument(content, resolvedPath, visitedFiles);
  } catch (error) {
    return {
      errorMessage: `Failed to load imported file ${resolvedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      lineNumber: 0,
    };
  }
}

export const getDocument = async (
  content: string,
  filepath?: string,
  visitedFiles: Set<string> = new Set(),
): Promise<KulalaDocument> => {
  const {
    directives,
    contentWithoutDirectives,
    errors: directiveErrors,
    directiveLinesRemoved,
  } = extractDirectives(content);

  const blocks = await getBlocks(contentWithoutDirectives, filepath);
  const fileHeaderVariables = extractFileHeaderAtVariables(
    contentWithoutDirectives,
  );
  const nativeBlockCount = blocks.length;
  const allErrors = [...directiveErrors];

  // Include block-level parse errors in the document error set.
  for (const block of blocks) {
    for (const err of block.errors ?? []) {
      const blockStart = block.position?.start ?? 0;
      const relLine = err.lineNumber ?? 0;
      allErrors.push({
        ...err,
        blockName: block.name,
        lineNumber: blockStart + relLine + directiveLinesRemoved,
      });
    }
  }

  // Process imports: load files and merge their blocks
  const importedBlocks: KulalaBlock[] = [];
  const importedDocuments: Map<string, KulalaDocument> = new Map();

  for (const directive of directives) {
    if (directive.type === "import") {
      const result = await loadImportedFile(
        directive.filepath,
        filepath,
        visitedFiles,
      );
      if ("errorMessage" in result) {
        allErrors.push(result);
      } else {
        importedDocuments.set(directive.filepath, result);
        importedBlocks.push(
          ...attachSourceFileHeaderVars(
            result.blocks,
            result.fileHeaderVariables ?? {},
          ),
        );
      }
    }
  }

  // Process run directives: find blocks by name from imported files
  const runBlocks: KulalaBlock[] = [];
  for (const directive of directives) {
    if (directive.type === "run") {
      const target = directive.target.trim();
      if (target.startsWith("#")) {
        // Run specific block by name: run #BLOCK_NAME
        const blockName = target.slice(1);
        let found = false;

        // Search in imported documents first
        for (const [importPath, doc] of importedDocuments.entries()) {
          const block = doc.blocks.find((b) => b.name === blockName);
          if (block) {
            found = true;
            // Clone block and apply variable overrides if any
            const runBlock: KulalaBlock = {
              ...block,
              name: `${block.name}_from_${importPath.split("/").pop()}`,
            };
            // Store variable overrides in a custom property (we'll handle this in runner)
            (runBlock as BlockWithRunDirective).__runDirective = directive;
            runBlocks.push(runBlock);
            break;
          }
        }

        // Also search in current document blocks
        if (!found) {
          const block = blocks.find((b) => b.name === blockName);
          if (block) {
            found = true;
            const runBlock: KulalaBlock = {
              ...block,
            };
            (runBlock as BlockWithRunDirective).__runDirective = directive;
            runBlocks.push(runBlock);
          }
        }

        if (!found) {
          allErrors.push({
            errorMessage: `Block not found: ${blockName}`,
            lineNumber: directive.lineNumber,
          });
        }
      } else {
        // Run all blocks from a file: run ./file.http
        const result = await loadImportedFile(target, filepath, visitedFiles);
        if ("errorMessage" in result) {
          allErrors.push({
            errorMessage: result.errorMessage,
            lineNumber: directive.lineNumber,
          });
        } else {
          for (const block of attachSourceFileHeaderVars(
            result.blocks,
            result.fileHeaderVariables ?? {},
          )) {
            const runBlock: KulalaBlock = {
              ...block,
            };
            (runBlock as BlockWithRunDirective).__runDirective = directive;
            runBlocks.push(runBlock);
          }
        }
      }
    }
  }

  // Process run directives inside blocks (blocks that contain "run #BLOCK_NAME")
  for (const block of blocks) {
    const blockRunDirective = (block as BlockWithRunDirective)
      .__blockRunDirective;
    if (blockRunDirective) {
      const target = blockRunDirective.target.trim();
      if (target.startsWith("#")) {
        // Run specific block by name: run #BLOCK_NAME
        const blockName = target.slice(1);
        let found = false;

        // Search in imported documents first
        for (const [, doc] of importedDocuments.entries()) {
          const referencedBlock = doc.blocks.find((b) => b.name === blockName);
          if (referencedBlock) {
            found = true;
            // Replace block's request with referenced block's request
            block.request = referencedBlock.request;
            block.scripts = referencedBlock.scripts;
            if (referencedBlock.sourceFileHeaderVariables !== undefined) {
              block.sourceFileHeaderVariables =
                referencedBlock.sourceFileHeaderVariables;
            }
            // Store run directive for variable overrides
            (block as BlockWithRunDirective).__runDirective = blockRunDirective;
            delete (block as BlockWithRunDirective).__blockRunDirective;
            break;
          }
        }

        // Also search in current document blocks
        if (!found) {
          const referencedBlock = blocks.find((b) => b.name === blockName);
          if (referencedBlock) {
            found = true;
            // Replace block's request with referenced block's request
            block.request = referencedBlock.request;
            block.scripts = referencedBlock.scripts;
            if (referencedBlock.sourceFileHeaderVariables !== undefined) {
              block.sourceFileHeaderVariables =
                referencedBlock.sourceFileHeaderVariables;
            }
            // Store run directive for variable overrides
            (block as BlockWithRunDirective).__runDirective = blockRunDirective;
            delete (block as BlockWithRunDirective).__blockRunDirective;
          }
        }

        if (!found) {
          allErrors.push({
            errorMessage: `Block not found: ${blockName}`,
            lineNumber: blockRunDirective.lineNumber,
          });
        }
      }
    }
  }

  // Combine: current blocks + imported blocks + run blocks
  const allBlocks = [...blocks, ...importedBlocks, ...runBlocks];

  return {
    filepath,
    directives,
    blocks: allBlocks,
    hasErrors: allErrors.length > 0,
    directiveLinesRemoved,
    nativeBlockCount,
    ...(Object.keys(fileHeaderVariables).length > 0
      ? { fileHeaderVariables }
      : {}),
  };
};
