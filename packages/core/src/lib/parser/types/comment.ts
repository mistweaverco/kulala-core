export type KulalaCommentString = `# ${string}` | `## ${string}`;

export type KulalaComment = {
  content: string;
  lineNumber: number;
  /** Indentation before the `#` / `//` marker (e.g. URL continuation comments). */
  leadingWhitespace?: string;
};
