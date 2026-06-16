import { describe, expect, test } from "bun:test";
import { parseGrpcAddress } from "./parse-target";

describe("parseGrpcAddress", () => {
  test("treats bare host:port as plaintext", () => {
    expect(parseGrpcAddress("grpc.postman-echo.com:443")).toEqual({
      channelTarget: "grpc.postman-echo.com:443",
      useTls: false,
    });
  });

  test("treats localhost as plaintext without a scheme", () => {
    expect(parseGrpcAddress("localhost:50051")).toEqual({
      channelTarget: "localhost:50051",
      useTls: false,
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
