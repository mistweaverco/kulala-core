import { describe, expect, test } from "bun:test";
import {
  base64EncodeStandard,
  handleCryptoOp,
  jwtEncode,
  pkceChallenge,
  pkceVerifier,
} from "./index";

describe("crypto", () => {
  test("base64_encode_standard", async () => {
    expect(
      await handleCryptoOp("base64_encode_standard", { input: "hello" }),
    ).toBe(base64EncodeStandard("hello"));
  });

  test("pkce_verifier length", async () => {
    const v = await handleCryptoOp("pkce_verifier", {});
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  test("pkce_challenge S256", async () => {
    const verifier = pkceVerifier();
    const challenge = await handleCryptoOp("pkce_challenge", {
      verifier,
      method: "S256",
    });
    expect(challenge).toBe(pkceChallenge(verifier, "S256"));
  });

  test("jwt_encode HS256", async () => {
    const token = await handleCryptoOp("jwt_encode", {
      header: { alg: "HS256", typ: "JWT" },
      payload: { sub: "user" },
      key: "secret",
    });
    expect(token.split(".")).toHaveLength(3);
    expect(jwtEncode({ alg: "HS256" }, { sub: "user" }, "secret")).toBe(token);
  });
});
