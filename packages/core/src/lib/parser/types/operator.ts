export type KulalaOperatorName =
  | "name"
  | "accept"
  | "no-redirect"
  | "no-log"
  | "no-cookie-jar"
  | "no-auto-encoding"
  | "timeout"
  | "connection-timeout"
  | "kulala-curl-insecure"
  | "kulala-curl-timeout"
  | "kulala-curl-connect-timeout"
  | "kulala-file-contents-to-variable"
  | "kulala-expect-status-code"
  | "kulala-prompt"
  | "grpc-import-path"
  | "grpc-proto"
  | "grpc-protoset"
  | "grpc-plaintext"
  | "grpc-v";

export const kulalaOperatorNames: Set<KulalaOperatorName> = new Set([
  "name",
  "accept",
  "no-redirect",
  "no-log",
  "no-cookie-jar",
  "no-auto-encoding",
  "timeout",
  "connection-timeout",
  "kulala-curl-insecure",
  "kulala-curl-timeout",
  "kulala-curl-connect-timeout",
  "kulala-file-contents-to-variable",
  "kulala-expect-status-code",
  "kulala-prompt",
  "grpc-import-path",
  "grpc-proto",
  "grpc-protoset",
  "grpc-plaintext",
  "grpc-v",
]);

export type KulalaOperatorArgs = string | number | boolean;

export type KulalaOperatorString =
  `# @${KulalaOperatorName}${KulalaOperatorArgs extends string
    ? ` ${KulalaOperatorArgs}`
    : ""}`;

export type KulalaOperator = {
  name: KulalaOperatorName;
  args?: KulalaOperatorArgs;
  lineNumber: number;
};
