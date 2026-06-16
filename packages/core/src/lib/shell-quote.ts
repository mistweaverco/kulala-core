export function shellQuote(value: string, preferDouble = false): string {
  if (preferDouble) {
    if (!value.includes('"') && !value.includes("$")) return `"${value}"`;
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
