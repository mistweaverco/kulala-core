/** grpcurl-style flag from `# @grpc-*` operators or inline on the request line. */
export type KulalaGrpcFlag = { flag: string; value: string };

/** Parsed GRPC request target (space-separated tokens after `GRPC`). */
export type KulalaGrpcCommand = {
  address?: string;
  command?: "describe" | "list";
  symbol?: string;
  inlineFlags: KulalaGrpcFlag[];
};
