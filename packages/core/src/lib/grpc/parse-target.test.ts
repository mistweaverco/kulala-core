import { describe, expect, test } from "bun:test";
import {
  grpcChannelOptionsForAuthority,
  grpcFlagsToLoaderOptions,
  parseGrpcAddress,
} from "./parse-target";
import { grpcFlagsFromOperators } from "./collect-flags";

describe("parseGrpcAddress", () => {
  test("treats bare host:port as TLS by default (grpcurl parity)", () => {
    expect(parseGrpcAddress("grpc.postman-echo.com:443")).toEqual({
      channelTarget: "grpc.postman-echo.com:443",
      useTls: true,
    });
  });

  test("treats localhost as TLS without a scheme", () => {
    expect(parseGrpcAddress("localhost:50051")).toEqual({
      channelTarget: "localhost:50051",
      useTls: true,
    });
  });

  test("enables TLS for grpcs:// and https://", () => {
    expect(parseGrpcAddress("grpcs://api.example.com:443")).toEqual({
      channelTarget: "api.example.com:443",
      useTls: true,
    });
    expect(parseGrpcAddress("https://api.example.com:443")).toEqual({
      channelTarget: "api.example.com:443",
      useTls: true,
    });
  });

  test("disables TLS for grpc://", () => {
    expect(parseGrpcAddress("grpc://localhost:50051")).toEqual({
      channelTarget: "localhost:50051",
      useTls: false,
    });
  });
});

describe("grpc-authority", () => {
  test("maps # @grpc-authority to the authority flag", () => {
    expect(
      grpcFlagsFromOperators([
        {
          name: "grpc-authority",
          args: "real.example.com",
          lineNumber: 0,
        },
      ]),
    ).toEqual([{ flag: "authority", value: "real.example.com" }]);
  });

  test("extracts authority from loader options", () => {
    const opts = grpcFlagsToLoaderOptions(
      [{ flag: "authority", value: "real.example.com" }],
      "/project",
    );
    expect(opts.authority).toBe("real.example.com");
  });

  test("builds channel options for SSL name override and :authority", () => {
    expect(grpcChannelOptionsForAuthority(undefined)).toBeUndefined();
    expect(grpcChannelOptionsForAuthority("real.example.com")).toEqual({
      "grpc.ssl_target_name_override": "real.example.com",
      "grpc.default_authority": "real.example.com",
    });
  });
});

describe("grpc-insecure", () => {
  test("maps # @grpc-insecure to the insecure flag", () => {
    expect(
      grpcFlagsFromOperators([
        {
          name: "grpc-insecure",
          lineNumber: 0,
        },
      ]),
    ).toEqual([{ flag: "insecure", value: "" }]);
  });

  test("extracts insecure from loader options", () => {
    expect(
      grpcFlagsToLoaderOptions([{ flag: "insecure", value: "" }], "/project")
        .insecure,
    ).toBe(true);
    expect(grpcFlagsToLoaderOptions([], "/project").insecure).toBe(false);
  });
});
