import type { KulalaBlock } from "../parser/types/block";
import { isSharedBlockName } from "../shared-blocks";
import type { KulalaOperator } from "../parser/types/operator";
import type { KulalaGrpcFlag } from "./types";

const GRPC_OPERATOR_MAP: Record<string, string> = {
  "grpc-import-path": "import-path",
  "grpc-proto": "proto",
  "grpc-protoset": "protoset",
  "grpc-plaintext": "plaintext",
  "grpc-v": "v",
};

export function grpcFlagsFromOperators(
  operators: KulalaOperator[],
): KulalaGrpcFlag[] {
  const flags: KulalaGrpcFlag[] = [];
  for (const op of operators) {
    const mapped = GRPC_OPERATOR_MAP[op.name];
    if (!mapped) continue;
    const value = op.args != null ? String(op.args).trim() : "";
    flags.push({ flag: mapped, value });
  }
  return flags;
}

/** Collect `# @grpc-*` flags from KULALA_SHARED blocks in the document. */
export function collectSharedGrpcFlags(
  blocks: KulalaBlock[],
): KulalaGrpcFlag[] {
  const out: KulalaGrpcFlag[] = [];
  for (const block of blocks) {
    if (isSharedBlockName(block.name)) {
      out.push(...grpcFlagsFromOperators(block.operators));
    }
  }
  return out;
}
