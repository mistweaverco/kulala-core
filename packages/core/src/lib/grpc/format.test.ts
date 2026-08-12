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
    expect(cmd).not.toContain("-plaintext");
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
    expect(list).toBe("grpcurl 'localhost:8080' list");

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

  test("adds -insecure for # @grpc-insecure on TLS connections", () => {
    const withOperator = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:50051",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [{ flag: "insecure", value: "" }],
      cwd: "/project",
    });
    expect(withOperator).toContain("-insecure");
    expect(withOperator).not.toContain("-plaintext");

    const withPlaintextWins = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:50051",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [
        { flag: "plaintext", value: "" },
        { flag: "insecure", value: "" },
      ],
      cwd: "/project",
    });
    expect(withPlaintextWins).toContain("-plaintext");
    expect(withPlaintextWins).not.toContain("-insecure");
  });

  test("adds -plaintext only for # @grpc-plaintext or grpc:// scheme", () => {
    const withOperator = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:8080",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [{ flag: "plaintext", value: "" }],
      cwd: "/project",
    });
    expect(withOperator).toContain("-plaintext");

    const grpcScheme = formatGrpcurlCommand({
      grpcCommand: {
        address: "grpc://localhost:50051",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [],
      cwd: "/project",
    });
    expect(grpcScheme).toContain("-plaintext");
    expect(grpcScheme).toContain("localhost:50051");
  });

  test("adds -insecure for bare host:port when curl insecure is set", () => {
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
    expect(cmd).not.toContain("-plaintext");
    expect(cmd).toContain("-insecure");
    expect(cmd).toContain("grpc.postman-echo.com:443");
  });

  test("substitutes variables in address, symbol, body, and proto paths", () => {
    const cmd = formatGrpcurlCommand({
      grpcCommand: {
        address: "{{grpc.addr}}:{{grpc.port}}",
        symbol: "{{grpc.service}}/SayHello",
        inlineFlags: [],
      },
      flags: [
        { flag: "import-path", value: "{{grpc.import}}" },
        { flag: "proto", value: "{{grpc.import}}/echo.proto" },
      ],
      headers: { "Content-Type": "application/json" },
      body: '{\n  "greeting": "{{name}}"\n}',
      cwd: "/project",
      vars: {
        "grpc.addr": "grpc.postman-echo.com",
        "grpc.port": "443",
        "grpc.service": "HelloService",
        "grpc.import": "grpc/echopb",
        name: "kulala!",
      },
    });
    expect(cmd).toContain("grpc.postman-echo.com:443");
    expect(cmd).toContain("HelloService/SayHello");
    expect(cmd).toContain("grpc/echopb/echo.proto");
    expect(cmd).toContain("kulala!");
    expect(cmd).not.toContain("{{");
  });

  test("formats -authority from flags for TLS tunnel overrides", () => {
    const cmd = formatGrpcurlCommand({
      grpcCommand: {
        address: "localhost:50051",
        symbol: "pkg.Service/Method",
        inlineFlags: [],
      },
      flags: [{ flag: "authority", value: "real.example.com" }],
      cwd: "/project",
    });
    expect(cmd).toContain("-authority");
    expect(cmd).toContain("real.example.com");
    expect(cmd).toContain("localhost:50051");
  });
});
