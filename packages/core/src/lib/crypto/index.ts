import { createHash, createHmac, createSign, randomBytes } from "node:crypto";

export { generatePKCE, generatePKCEPlain } from "../auth/oauth2/browser-flow";

export function base64EncodeStandard(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

export function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

/** Random PKCE verifier (RFC 7636). */
export function pkceVerifier(): string {
  const bytes = randomBytes(32);
  return bytes.toString("base64url").slice(0, 43);
}

export function pkceChallenge(
  verifier: string,
  method: "S256" | "Plain" = "S256",
): string {
  if (method === "Plain") return verifier;
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export type JwtHeader = { alg: string; typ?: string };
export type JwtPayload = Record<string, unknown>;

/** Sign a JWT (HS256 or RS256). */
export function jwtEncode(
  header: JwtHeader,
  payload: JwtPayload,
  key: string,
): string {
  const alg = header.alg;
  if (alg !== "HS256" && alg !== "RS256") {
    throw new Error(`Unsupported JWT algorithm: ${alg}`);
  }

  const headerB64 = base64UrlEncode(
    Buffer.from(JSON.stringify({ typ: "JWT", ...header })),
  );
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  if (alg === "HS256") {
    const signature = createHmac("sha256", key)
      .update(unsigned)
      .digest("base64url");
    return `${unsigned}.${signature}`;
  }

  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(key).toString("base64url");
  return `${unsigned}.${signature}`;
}

export async function handleCryptoOp(
  op: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (op) {
    case "pkce_verifier":
      return pkceVerifier();
    case "pkce_challenge": {
      const verifier = String(args.verifier ?? "");
      if (!verifier) throw new Error("pkce_challenge requires verifier");
      const method = (args.method as "S256" | "Plain" | undefined) ?? "S256";
      return pkceChallenge(verifier, method);
    }
    case "jwt_encode": {
      const header = args.header as JwtHeader | undefined;
      const payload = args.payload as JwtPayload | undefined;
      const key = String(args.key ?? "");
      if (!header?.alg) throw new Error("jwt_encode requires header.alg");
      if (!payload) throw new Error("jwt_encode requires payload");
      if (!key) throw new Error("jwt_encode requires key");
      return jwtEncode(header, payload, key);
    }
    case "base64_encode_standard": {
      const input = String(args.input ?? "");
      return base64EncodeStandard(input);
    }
    default:
      throw new Error(`Unknown crypto op: ${op}`);
  }
}
