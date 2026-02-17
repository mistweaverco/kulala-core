/**
 * Replace {{variableName}} or {{ variableName }} in a string with values from vars.
 * Supports simple names (e.g. API_KEY) and compound request vars (e.g. REQUEST_ONE.response.body.$.json.token).
 * Optional whitespace around the variable name is allowed.
 * Unknown variables are replaced with empty string.
 * If resolver is provided, it is used for missing keys (e.g. request variables).
 */
export function substituteInString(
  template: string,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, name) => {
    const key = name.trim();
    const fromVars = vars[key];
    if (fromVars !== undefined) return fromVars;
    if (resolver) {
      const resolved = resolver(key);
      if (resolved !== undefined) return resolved;
    }
    return "";
  });
}

/**
 * Recursively substitute {{var}} in any string values in obj (for request body).
 */
export function substituteInObject(
  obj: unknown,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
): unknown {
  if (typeof obj === "string") {
    return substituteInString(obj, vars, resolver);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item, vars, resolver));
  }
  if (typeof obj === "object" && obj !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = substituteInObject(v, vars, resolver);
    }
    return out;
  }
  return obj;
}
