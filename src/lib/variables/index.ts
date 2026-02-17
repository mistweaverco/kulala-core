/**
 * Variable resolution and substitution for HTTP requests.
 * - Stable document ID (filepath or content hash) so variables don't leak between documents.
 * - Kuba: traverse up for kuba.yaml, run `kuba show --contain --env <env> --output json`.
 * - Persistence: global, document-scoped, and request-scoped variables from SQLite.
 * - Substitution: {{variableName}} in URL, headers, and body.
 */

export { getStableDocumentId } from "./stable-id";
export { findKubaYamlDir, getKubaEnv, isKubaInPath } from "./kuba";
export { resolveVariables } from "./resolve";
export { substituteInString, substituteInObject } from "./substitute";
