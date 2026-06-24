/**
 * HTTP Client Security.Auth configuration and token types.
 * Aligned with the JetBrains HTTP Client auth spec, plus Kulala extensions where noted.
 */

/** Static token auth for development and testing (JetBrains "Mock" type). */
export interface MockConfig {
  Type: "Mock";
  Token: string;
  "ID Token"?: string;
}

export type AuthConfig = OAuth2Config | MockConfig;

export function isOAuth2Config(config: AuthConfig): config is OAuth2Config {
  return config.Type === "OAuth2";
}

export function isMockConfig(config: AuthConfig): config is MockConfig {
  return config.Type === "Mock";
}

export type OAuth2GrantType =
  | "Authorization Code"
  | "Client Credentials"
  | "Device Authorization"
  | "Implicit"
  | "Password";

/** JetBrains Client Credentials location. "jwt" is a Kulala extension. */
export type OAuth2ClientCredentialsLocation =
  | "none"
  | "in body"
  | "basic"
  | "jwt";

export type OAuth2RequestScope =
  | "In Token Request"
  | "In Auth Request"
  | "Everywhere";

export type OAuth2ScopedValue =
  | string
  | string[]
  | {
      Value: string | string[];
      Use: OAuth2RequestScope;
    };

/** JetBrains PKCE Code Challenge Method values (S256 accepted as alias). */
export type OAuth2PkceChallengeMethod = "Plain" | "SHA-256" | "S256";

export interface OAuth2Config {
  Type: "OAuth2";
  "Grant Type": OAuth2GrantType;
  "Auth URL"?: string;
  "Token URL"?: string;
  "Redirect URL"?: string;
  /** Kulala extension: token revocation endpoint. */
  "Revoke URL"?: string;
  "Client ID": string;
  "Client Secret"?: string;
  "Device Auth URL"?: string;
  /** Device Authorization: open verification_uri_complete in the browser. */
  "Open Complete URI"?: boolean;
  /** Device Authorization: poll token endpoint only after the browser closes. */
  "Start Polling After Browser"?: boolean;
  /** Kulala extension: explicit OAuth response_type override. */
  "Response Type"?: string;
  "Client Credentials"?: OAuth2ClientCredentialsLocation;
  PKCE?:
    | boolean
    | {
        "Code Challenge Method"?: OAuth2PkceChallengeMethod;
        "Code Verifier"?: string;
      };
  /** Kulala extension: pre-built JWT assertion for Client Credentials "jwt". */
  Assertion?: string;
  /** Kulala extension: auto-generated JWT assertion settings. */
  JWT?: {
    Header: {
      alg: "RS256" | "HS256";
      typ: "JWT";
    };
    Payload: {
      exp?: number;
      iat?: number;
      [key: string]: unknown;
    };
  };
  /** Kulala extension: PEM private key for RS256 JWT assertions (private env). */
  private_key?: string;
  Scope?: string;
  /** Kulala extension: fallback token lifetime when the provider omits expires_in. */
  "Expires In"?: number;
  "Acquire Automatically"?: boolean;
  Username?: string;
  Password?: string;
  "Custom Headers"?: Record<string, OAuth2ScopedValue>;
  "Custom Request Parameters"?: Record<string, OAuth2ScopedValue>;
  /** Kulala extension: shell command to open the authorization URL. */
  "Browser CMD"?: string;
  "Use ID Token"?: boolean;
}

export interface OAuth2TokenData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_at?: number;
}

export interface OAuth2AuthData {
  [authId: string]: OAuth2TokenData;
}
