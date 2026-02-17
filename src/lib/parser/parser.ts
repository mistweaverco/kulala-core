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
import { getScript } from "./script";
import { getHeader } from "./header";
import { getBody } from "./body";
import type { KulalaHeader } from "./types/header";
import { getComment } from "./comment";
import { getRequest } from "./request";
import type { KulalaRequest } from "./types/request";
import type { KulalaRequestBody } from "./types/body";
const blockRegex = /###(.*?)\n([\s\S]+?)(?=###|$)/g;
const nameRegex = /### (.+?)\n/;

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
  if (line.startsWith("< ")) {
    return { name: "preRequestScript", lineNumber: lineIdx };
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
    !seenBlockTypes.has("body") &&
    line.includes(": ")
  ) {
    return { name: "headers", lineNumber: lineIdx };
  }
  if (seenBlockTypes.has("request") && line.trim() === "") {
    return { name: "afterHeaders", lineNumber: lineIdx };
  }
  if (seenBlockTypes.has("afterHeaders") && line.startsWith("> ")) {
    return { name: "postRequestScript", lineNumber: lineIdx };
  }
  if (
    seenBlockTypes.has("request") &&
    seenBlockTypes.has("afterHeaders") &&
    !seenBlockTypes.has("afterBody") &&
    !seenBlockTypes.has("postRequestScript")
  ) {
    return { name: "body", lineNumber: lineIdx };
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
  let request: KulalaRequest | KulalaError;
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
    switch (lineType.name) {
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
        body = await getBody(lines, lineIdx);
        if (isError(body)) {
          result.errors.push(body);
          break;
        }
        result.request.body = body.content;
        break;
      case "preRequestScript":
      case "postRequestScript":
        script = await getScript(line, lines, lineIdx, filepath);
        if (isError(script)) {
          result.errors.push(script);
          break;
        }
        result.scripts[script.type].push(script);
        break;
      default:
        break;
    }
    lineIdx++;
  }
  return result as KulalaBlock;
};

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

export const getDocument = async (
  content: string,
  filepath?: string,
): Promise<KulalaDocument> => {
  const blocks = await getBlocks(content, filepath);
  return {
    filepath,
    blocks,
  };
};
