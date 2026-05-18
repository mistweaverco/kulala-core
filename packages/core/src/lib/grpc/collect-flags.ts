import type { KulalaBlock } from "../parser/types/block";
import type { KulalaOperator } from "../parser/types/operator";
import type { KulalaGrpcFlag } from "./types";
import { resolve } from "node:path";

const GRPC_OPERATOR_MAP: Record<string, string> = {
  "grpc-import-path": "import-path",
  "grpc-proto": "proto",
  "grpc-protoset": "protoset",
  "grpc-plaintext": "plaintext",
  "grpc-v": "v",
};

export function grpcFlagsFromOperators(
  operators: KulalaOperator[],
  cwd: string,
): KulalaGrpcFlag[] {
  const flags: KulalaGrpcFlag[] = [];
  for (const op of operators) {
    const mapped = GRPC_OPERATOR_MAP[op.name];
    if (!mapped) continue;
    let value = op.args != null ? String(op.args).trim() : "";
    if (mapped === "import-path" && value) {
      value = resolve(cwd, value);
    } else if ((mapped === "proto" || mapped === "protoset") && value) {
      value = resolve(cwd, value);
    }
    flags.push({ flag: mapped, value });
  }
  return flags;
}

/** Collect `# @grpc-*` flags from Shared blocks in the document. */
export function collectSharedGrpcFlags(
  blocks: KulalaBlock[],
  cwd: string,
): KulalaGrpcFlag[] {
  const out: KulalaGrpcFlag[] = [];
  for (const block of blocks) {
    if (block.name === "Shared" || block.name === "Shared each") {
      out.push(...grpcFlagsFromOperators(block.operators, cwd));
    }
  }
  return out;
}
