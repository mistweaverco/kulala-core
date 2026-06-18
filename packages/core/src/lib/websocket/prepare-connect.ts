import {
  substituteInObject,
  substituteInString,
} from "../variables/substitute";
import type { WebSocketConnectOptions } from "./websocket-session";

export type WebSocketConnectInput = WebSocketConnectOptions & {
  /** When url/body/headers still contain {{var}}, substitute with this map. */
  vars?: Record<string, string>;
};

/**
 * Apply variable substitution to a WebSocket connect payload before opening the session.
 * Callers should pass values already resolved by kulala-core run when possible; `vars`
 * is a fallback for direct `--websocket` invocations.
 */
export function prepareWebSocketConnect(
  input: WebSocketConnectInput,
): WebSocketConnectOptions {
  const vars = input.vars ?? {};
  const hasTemplates =
    input.url.includes("{{") ||
    (input.body?.includes("{{") ?? false) ||
    Object.values(input.headers ?? {}).some((v) => v.includes("{{"));

  if (!hasTemplates) {
    return {
      url: input.url,
      body: input.body,
      headers: input.headers,
    };
  }

  if (Object.keys(vars).length === 0) {
    throw new Error(
      "WebSocket connect URL or payload contains unresolved {{variables}}; resolve the request in kulala-core first",
    );
  }

  const headers = input.headers
    ? (substituteInObject(input.headers, vars) as Record<string, string>)
    : undefined;
  const body =
    input.body != null
      ? (substituteInObject(input.body, vars) as string)
      : undefined;

  return {
    url: substituteInString(input.url, vars),
    ...(body !== undefined ? { body } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}
