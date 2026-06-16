import { describe, expect, test } from "bun:test";
import { formatGrpcurlCommand } from "./format";

describe("formatGrpcurlCommand", () => {
  test("formats unary call with proto flags, metadata, and body", () => {
    const cmd = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:8080",
        symbol: "grpc_echo.v1.EchoService/Echo",
        inlineFlags: [],
      },
      flags: [
        { flag: "import-path", value: "grpc/echopb" },
        { flag: "proto", value: "grpc/echopb/echo.proto" },
      ],
      headers: { "Content-Type": "application/json" },
      body: '{\n  "ping": "Hello, world!"\n}',
      cwd: "/project",
    });
    expect(cmd).toContain("grpcurl");
    expect(cmd).toContain("-plaintext");
    expect(cmd).toContain("-import-path");
    expect(cmd).toContain("-proto");
    expect(cmd).toContain("-H");
    expect(cmd).toContain("Content-Type");
    expect(cmd).toContain("-d");
    expect(cmd).toContain("Hello, world!");
    expect(cmd).toContain("localhost:8080");
    expect(cmd).toContain("grpc_echo.v1.EchoService/Echo");
  });

  test("formats list and describe subcommands", () => {
    const list = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:8080",
        command: "list",
        inlineFlags: [],
      },
      flags: [],
      cwd: "/project",
    });
    expect(list).toBe("grpcurl -plaintext 'localhost:8080' list");

    const describeCmd = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:8080",
        command: "describe",
        symbol: "helloworld.Greeter",
        inlineFlags: [],
      },
      flags: [],
      cwd: "/project",
    });
    expect(describeCmd).toContain("describe");
    expect(describeCmd).toContain("helloworld.Greeter");
  });

  test("adds -insecure for TLS addresses and -plaintext for explicit operator", () => {
    const tls = formatGrpcurlCommand({
      grpcCommand: {
        address: "grpcs://example.com:443",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [],
      cwd: "/project",
      insecure: true,
    });
    expect(tls).toContain("-insecure");
    expect(tls).not.toContain("-plaintext");
    expect(tls).toContain("example.com:443");

    const explicitPlaintext = formatGrpcurlCommand({
      grpcCommand: {
        address: "grpcs://example.com:443",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [{ flag: "plaintext", value: "" }],
      cwd: "/project",
      insecure: true,
    });
    expect(explicitPlaintext).toContain("-plaintext");
    expect(explicitPlaintext).not.toContain("-insecure");
  });

  test("omits -insecure for bare host:port even when curl insecure is set", () => {
    const cmd = formatGrpcurlCommand({
      grpcCommand: {
        address: "grpc.postman-echo.com:443",
        symbol: "HelloService/SayHello",
        inlineFlags: [],
      },
      flags: [],
      cwd: "/project",
      insecure: true,
    });
    expect(cmd).toContain("-plaintext");
    expect(cmd).not.toContain("-insecure");
    expect(cmd).toContain("grpc.postman-echo.com:443");
  });
});
