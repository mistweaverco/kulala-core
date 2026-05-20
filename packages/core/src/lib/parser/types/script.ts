export type KulalaScriptType = "preRequest" | "postRequest";

export type KulalaScript = {
  type: KulalaScriptType;
  lang: "ts" | "js" | "lua";
  /** Inline `{% %} block in HTTP vs external `< path` / `> path`. */
  source: "inline" | "file";
  /** For `file`, path to script relative to cwd; for inline, the enclosing HTTP document path. */
  filepath?: string;
  content: string;
  /** 0-based line index inside the parsed request block (`###` …) where script starts. */
  lineNumber: number;
};

export type KulalaScripts = {
  [key in KulalaScriptType]: KulalaScript[];
};
