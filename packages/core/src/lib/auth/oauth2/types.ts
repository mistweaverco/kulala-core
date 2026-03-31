/**
 * OAuth 2.0 configuration and token types.
 * Based on Kulala/JetBrains HTTP Client OAuth2 spec.
 */

export type OAuth2GrantType =
  | "Authorization Code"
  | "Client Credentials"
  | "Device Authorization"
  | "Implicit"
  | "Password";

export type OAuth2ClientCredentialsLocation =
  | "none"
  | "in body"
  | "basic"
  | "jwt";

export interface OAuth2Config {
  Type: "OAuth2";
  "Grant Type": OAuth2GrantType;
  "Auth URL"?: string; // Required for Authorization Code, Implicit
  "Token URL": string; // Required for all except Implicit
  "Redirect URL"?: string;
  "Revoke URL"?: string;
  "Client ID": string;
  "Client Secret"?: string; // Required for Client Credentials
  "Device Auth URL"?: string; // Required for Device Authorization
  "Response Type"?: string; // Optional, auto-added
  "Client Credentials"?: OAuth2ClientCredentialsLocation; // Default: "basic"
  PKCE?:
    | boolean
    | {
        "Code Challenge Method"?: "Plain" | "S256";
        "Code Verifier"?: string;
      };
  Assertion?: string; // For Client Credentials with JWT
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
  Scope?: string;
  "Expires In"?: number; // Default: 10 seconds if not provided by provider
  "Acquire Automatically"?: boolean; // Default: true
  Username?: string; // For Password grant
  Password?: string; // For Password grant
  "Custom Headers"?: Record<string, string>;
  "Custom Request Parameters"?: Record<
    string,
    | string
    | string[]
    | {
        Value: string | string[];
        Use: "In Token Request" | "In Auth Request" | "Everywhere";
      }
  >;
  "Browser CMD"?: string;
  "Use ID Token"?: boolean;
}

export interface OAuth2TokenData {
  access_token: string;
  token_type?: string; // Usually "Bearer"
  expires_in?: number; // Seconds
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_at?: number; // Unix timestamp (calculated from expires_in)
}

export interface OAuth2AuthData {
  [authId: string]: OAuth2TokenData;
}
