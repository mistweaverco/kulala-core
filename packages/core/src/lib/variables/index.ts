/**
 * Variable resolution and substitution for HTTP requests.
 * - Stable document ID (filepath or content hash) so variables don't leak between documents.
 * - Kuba: traverse up for kuba.yaml, run `kuba show --env <env> --output json`.
 * - Env files: system env, http-client.env.json, http-client.private.env.json, .env (by env name).
 * - Persistence: global, document-scoped, and request-scoped variables from SQLite.
 * - System env as {{$env.VAR}}: JetBrains-style (https://www.jetbrains.com/help/idea/http-client-variables.html).
 * - Dynamic variables: $uuid, $random.uuid, $timestamp, $isoTimestamp, $date, $randomInt (0..1000).
 * - Request variables (only with `# @kulala-vscode-restclient-compat` in the .http file):
 *   {{REQUEST_NAME.response.body.$.field}}, {{REQUEST_NAME.response.headers.Name}}.
 *   Latest responses are persisted per document so named requests work across separate runs.
 * - JSONPath in {{ }} and scripts (2024.2+): dotted paths, .['key'], [*], [n] — see jsonpath.ts.
 * - Env/kuba nested JSON is also flattened to dotted paths for direct lookup.
 * - Substitution: {{variableName}} or compound paths; optional spaces {{ var }} in URL, headers, body.
 * - In-file @ variables: @name=value before the first ### or in a block preamble (JetBrains).
 */

export { getStableDocumentId } from "./stable-id";
export {
  findKubaYamlDir,
  getKubaEnv,
  isKubaInPath,
  listKubaEnvNames,
} from "./kuba";
export { loadEnvVars } from "./env-files";
export {
  type KulalaEnvironmentCatalog,
  kulalaSharedVariables,
  loadEnvironmentCatalog,
  mergeHttpClientEnvCatalog,
} from "./environments";
export {
  applyDefaultHeaders,
  DEFAULT_HEADERS_KEY,
  KULALA_SHARED_KEY,
  loadDefaultHeaders,
  resolveUrlFromHostHeader,
} from "./default-headers";
export { getMagicVariables } from "./magic";
export { type HttpFileVariableSources, resolveVariables } from "./resolve";
export {
  substituteInObject,
  substituteInObjectAsync,
  substituteInString,
  substituteInStringAsync,
} from "./substitute";
export {
  evaluateJsonPath,
  expressionHasWildcard,
  formatJsonPathResults,
  parseJsonPathSegments,
  splitVariableExpression,
} from "./jsonpath";
export {
  formatVariableForSubstitution,
  getByVariablePath,
  mergeVariableIntoFlat,
  parseStoredVariable,
  parseVariablePath,
  resolveVariableReference,
  writeVariableToMaps,
} from "./variable-lookup";
export {
  isRequestVariableKey,
  type PreviousResponse,
  resolveRequestVariable,
} from "./request-vars";
export { OAuth2Manager } from "../auth/oauth2/manager";
