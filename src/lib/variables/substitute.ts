/**
 * Replace {{variableName}} or {{ variableName }} in a string with values from vars.
 * Optional whitespace around the variable name is allowed.
 * Unknown variables are replaced with empty string.
 */
export function substituteInString(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, name) => vars[name] ?? "",
  );
}

/**
 * Recursively substitute {{var}} in any string values in obj (for request body).
 */
export function substituteInObject(
  obj: unknown,
  vars: Record<string, string>,
): unknown {
  if (typeof obj === "string") {
    return substituteInString(obj, vars);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item, vars));
  }
  if (typeof obj === "object" && obj !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = substituteInObject(v, vars);
    }
    return out;
  }
  return obj;
}
