import { describe, expect, test } from "bun:test";
import type { OAuth2Config } from "./types";
import {
  buildOAuth2CustomHeaders,
  normalizePkceConfigMethod,
  pkceMethodQueryValue,
} from "./request-builders";

describe("oauth2 request builders", () => {
  test("normalizePkceConfigMethod accepts JetBrains SHA-256", () => {
    expect(normalizePkceConfigMethod("SHA-256")).toBe("S256");
    expect(normalizePkceConfigMethod("S256")).toBe("S256");
    expect(normalizePkceConfigMethod("Plain")).toBe("Plain");
    expect(pkceMethodQueryValue("S256")).toBe("S256");
    expect(pkceMethodQueryValue("Plain")).toBe("plain");
  });

  test("buildOAuth2CustomHeaders respects Use scope", () => {
    const config = {
      Type: "OAuth2",
      "Grant Type": "Client Credentials",
      "Client ID": "id",
      "Custom Headers": {
        "X-Everywhere": "all",
        "X-Token": { Value: "token-only", Use: "In Token Request" },
        "X-Auth": { Value: "auth-only", Use: "In Auth Request" },
      },
    } as OAuth2Config;

    expect(buildOAuth2CustomHeaders(config, "In Token Request")).toEqual({
      "X-Everywhere": "all",
      "X-Token": "token-only",
    });
    expect(buildOAuth2CustomHeaders(config, "In Auth Request")).toEqual({
      "X-Everywhere": "all",
      "X-Auth": "auth-only",
    });
  });
});
