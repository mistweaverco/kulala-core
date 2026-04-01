export type KulalaOperatorName =
  | "accept"
  | "no-redirect"
  | "no-log"
  | "no-cookie-jar"
  | "no-auto-encoding"
  | "timeout"
  | "connection-timeout"
  | "kulala-curl-insecure"
  | "kulala-file-contents-to-variable"
  | "kulala-expect-status-code"
  | "kulala-prompt";

export const kulalaOperatorNames: Set<KulalaOperatorName> = new Set([
  "accept",
  "no-redirect",
  "no-log",
  "no-cookie-jar",
  "no-auto-encoding",
  "timeout",
  "connection-timeout",
  "kulala-curl-insecure",
  "kulala-file-contents-to-variable",
  "kulala-expect-status-code",
  "kulala-prompt",
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
