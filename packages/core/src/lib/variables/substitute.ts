import { resolveVariableReference } from "./variable-lookup";

/**
 * Max iterations for chained-variable expansion (e.g. one env var that
 * references another). Bounds runtime if values reference each other in a
 * cycle (`A = "{{B}}"`, `B = "{{A}}"`) or grow without converging
 * (`A = "x{{A}}"`).
 */
const MAX_SUBSTITUTION_DEPTH = 8;

const VAR_RE = /\{\{\s*([^}]+)\s*\}\}/g;

/**
 * One regex pass: replace every `{{ name }}` in `template` using `vars` and
 * the optional fallback `resolver`. Auth placeholders are preserved verbatim
 * so the async path can resolve them.
 */
function substituteInStringOnce(
  template: string,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
): string {
  return template.replace(VAR_RE, (_, name) => {
    const key = name.trim();

    // $auth.token() / $auth.idToken() require async resolution.
    const authMatch = key.match(/^\$auth\.(token|idToken)\s*\(/);
    if (authMatch) {
      return `{{${key}}}`;
    }

    const fromVars = resolveVariableReference(key, vars);
    if (fromVars !== undefined) return fromVars;
    if (resolver) {
      const resolved = resolver(key);
      if (resolved !== undefined) return resolved;
    }
    return "";
  });
}

/**
 * Replace {{variableName}} or {{ variableName }} in a string with values from vars.
 * Supports simple names (e.g. API_KEY), JetBrains JSONPath (e.g. CREDENTIALS.password, users[*].name),
 * and compound request vars (e.g. REQUEST_ONE.response.body.$.token).
 * Optional whitespace around the variable name is allowed.
 * Unknown variables are replaced with empty string.
 * If resolver is provided, it is used for missing keys (e.g. request variables).
 *
 * Values may themselves contain `{{...}}` references; substitution is applied
 * iteratively until the result stabilises or {@link MAX_SUBSTITUTION_DEPTH}
 * iterations have run, whichever comes first.
 *
 * Note: For $auth.token() and $auth.idToken() calls, use substituteInStringAsync instead.
 */
export function substituteInString(
  template: string,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
): string {
  let result = template;
  for (let depth = 0; depth < MAX_SUBSTITUTION_DEPTH; depth++) {
    const next = substituteInStringOnce(result, vars, resolver);
    if (next === result) return next;
    result = next;
    if (!result.includes("{{")) return result;
  }
  return result;
}

/**
 * One async pass: regex-walk `template` and produce the next string.
 * Handles regular vars, fallback resolver, and `$auth.token()`/`$auth.idToken()`
 * via the optional `authResolver`. Auth placeholders are preserved verbatim
 * when no `authResolver` is provided.
 */
async function substituteInStringOnceAsync(
  template: string,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
  authResolver?: (
    func: "token" | "idToken",
    authId: string,
  ) => Promise<string | undefined>,
): Promise<string> {
  const matches = Array.from(template.matchAll(VAR_RE));
  let result = template;

  // Process matches in reverse order to maintain correct indices when replacing
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i]!;
    const key = match[1]!.trim();
    let replacement: string;

    // Check for $auth.token("id") or $auth.idToken("id") syntax
    const authMatch = key.match(
      /^\$auth\.(token|idToken)\s*\(\s*["']([^"']+)["']\s*\)$/,
    );
    if (authMatch) {
      if (authResolver) {
        const func = authMatch[1] as "token" | "idToken";
        const authId = authMatch[2]!;
        const token = await authResolver(func, authId);
        replacement = token ?? "";
      } else {
        // No authResolver provided - keep placeholder as-is
        replacement = match[0]!;
      }
    } else {
      // Regular variable substitution
      const fromVars = resolveVariableReference(key, vars);
      if (fromVars !== undefined) {
        replacement = fromVars;
      } else if (resolver) {
        const resolved = resolver(key);
        replacement = resolved ?? "";
      } else {
        replacement = "";
      }
    }

    // Replace from end to start to preserve indices
    result =
      result.slice(0, match.index) +
      replacement +
      result.slice(match.index! + match[0]!.length);
  }

  return result;
}

/**
 * Async version that handles $auth.token() and $auth.idToken() calls.
 * Also supports all regular variable substitution.
 *
 * This function properly handles multiple occurrences of the same variable,
 * and re-expands values that themselves contain `{{...}}` references up to
 * {@link MAX_SUBSTITUTION_DEPTH} iterations.
 */
export async function substituteInStringAsync(
  template: string,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
  authResolver?: (
    func: "token" | "idToken",
    authId: string,
  ) => Promise<string | undefined>,
): Promise<string> {
  let result = template;
  for (let depth = 0; depth < MAX_SUBSTITUTION_DEPTH; depth++) {
    const next = await substituteInStringOnceAsync(
      result,
      vars,
      resolver,
      authResolver,
    );
    if (next === result) return next;
    result = next;
    if (!result.includes("{{")) return result;
  }
  return result;
}

/**
 * Recursively substitute {{var}} in any string values in obj (for request body).
 *
 * Note: For $auth.token() and $auth.idToken() calls, use substituteInObjectAsync instead.
 */
export function substituteInObject(
  obj: unknown,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
): unknown {
  if (Buffer.isBuffer(obj)) {
    return obj;
  }
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

/**
 * Async version that handles $auth.token() and $auth.idToken() calls.
 */
export async function substituteInObjectAsync(
  obj: unknown,
  vars: Record<string, string>,
  resolver?: (name: string) => string | undefined,
  authResolver?: (
    func: "token" | "idToken",
    authId: string,
  ) => Promise<string | undefined>,
): Promise<unknown> {
  if (Buffer.isBuffer(obj)) {
    return obj;
  }
  if (typeof obj === "string") {
    return await substituteInStringAsync(obj, vars, resolver, authResolver);
  }
  if (Array.isArray(obj)) {
    return await Promise.all(
      obj.map((item) =>
        substituteInObjectAsync(item, vars, resolver, authResolver),
      ),
    );
  }
  if (typeof obj === "object" && obj !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = await substituteInObjectAsync(v, vars, resolver, authResolver);
    }
    return out;
  }
  return obj;
}
