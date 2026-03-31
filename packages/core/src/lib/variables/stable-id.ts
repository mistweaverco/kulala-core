import { createHash } from "crypto";

/**
 * Build a stable document ID so variables from one HTTP document don't leak into another.
 * When there is no physical file, we can't rely on filepath; use a hash of the content instead.
 */
export function getStableDocumentId(
  filepath?: string,
  content?: string,
): string {
  if (filepath != null && filepath !== "") {
    return filepath;
  }
  if (content != null && content !== "") {
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    return `content:${hash}`;
  }
  return "anonymous";
}
