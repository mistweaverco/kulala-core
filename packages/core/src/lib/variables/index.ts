/**
 * Variable resolution and substitution for HTTP requests.
 * - Stable document ID (filepath or content hash) so variables don't leak between documents.
 * - Kuba: traverse up for kuba.yaml, run `kuba show --env <env> --output json`.
 * - Env files: system env, http-client.env.json, http-client.private.env.json, .env (by env name).
 * - Persistence: global, document-scoped, and request-scoped variables from SQLite.
 * - System env as {{$env.VAR}}: JetBrains-style (https://www.jetbrains.com/help/idea/http-client-variables.html).
 * - Dynamic variables: $uuid, $random.uuid, $timestamp, $isoTimestamp, $date, $randomInt (0..1000).
 * - Request variables: {{REQUEST_NAME.response.body.$.field}}, {{REQUEST_NAME.response.headers.Name}}.
 * - JSONPath-style in env/kuba: nested JSON flattened to dotted paths (client.host.url, client.['host.url']).
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
  kulalaSharedVariables,
  loadEnvironmentCatalog,
  mergeHttpClientEnvCatalog,
  type KulalaEnvironmentCatalog,
} from "./environments";
export {
  applyDefaultHeaders,
  DEFAULT_HEADERS_KEY,
  KULALA_SHARED_KEY,
  loadDefaultHeaders,
} from "./default-headers";
export { getMagicVariables } from "./magic";
export { resolveVariables, type HttpFileVariableSources } from "./resolve";
export {
  substituteInString,
  substituteInStringAsync,
  substituteInObject,
  substituteInObjectAsync,
} from "./substitute";
export {
  resolveRequestVariable,
  isRequestVariableKey,
  type PreviousResponse,
} from "./request-vars";
export { OAuth2Manager } from "../auth/oauth2/manager";
