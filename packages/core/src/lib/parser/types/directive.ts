export type KulalaImportDirective = {
  type: "import";
  filepath: string;
  lineNumber: number;
};

export type KulalaRunDirective = {
  type: "run";
  target: string; // File path or block name (e.g., "./file.http" or "#BLOCK_NAME")
  variableOverrides?: Record<string, string>; // e.g., { host: "example.com", user: "userName" }
  lineNumber: number;
};

export type KulalaDirective = KulalaImportDirective | KulalaRunDirective;
