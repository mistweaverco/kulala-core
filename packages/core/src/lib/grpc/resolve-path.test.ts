import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveGrpcPath } from "./resolve-path";
import { grpcFlagsToLoaderOptions } from "./parse-target";

const cwd = "/tmp/http-files";

describe("resolveGrpcPath", () => {
  test("resolves relative paths against cwd", () => {
    expect(resolveGrpcPath("grpc/echopb", cwd)).toBe(
      resolve(cwd, "grpc/echopb"),
    );
  });

  test("uses absolute paths as-is", () => {
    const abs = "/absolute/path/protos";
    expect(resolveGrpcPath(abs, cwd)).toBe(abs);
  });

  test("expands tilde to home directory", () => {
    expect(resolveGrpcPath("~/Projects/protos", cwd)).toBe(
      resolve(homedir(), "Projects/protos"),
    );
  });

  test("expands bare tilde to home directory", () => {
    expect(resolveGrpcPath("~", cwd)).toBe(homedir());
  });

  test("does not expand {{ $HOME }} as a bare env shorthand", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
    const resolved = resolveGrpcPath("{{ $HOME }}/Projects/protos", cwd);
    expect(resolved).not.toBe(resolve(home, "Projects/protos"));
    expect(resolved).toBe("/Projects/protos");
  });

  test("expands {{ $env.HOME }} JetBrains-style env reference", () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
    expect(resolveGrpcPath("{{ $env.HOME }}/Projects/protos", cwd)).toBe(
      resolve(home, "Projects/protos"),
    );
  });

  test("expands custom variables from the vars map", () => {
    expect(
      resolveGrpcPath("{{ PROTO_ROOT }}/service/v1/service.proto", cwd, {
        PROTO_ROOT: "/opt/protos",
      }),
    ).toBe("/opt/protos/service/v1/service.proto");
  });
});

describe("grpcFlagsToLoaderOptions", () => {
  test("resolves import-path and proto flags with tilde and absolute paths", () => {
    const homeProto = resolve(homedir(), "Projects/myapp/proto");
    const { importPaths, protoFiles } = grpcFlagsToLoaderOptions(
      [
        { flag: "import-path", value: "~/Projects/googleapis" },
        { flag: "import-path", value: "~/Projects/myapp/proto" },
        {
          flag: "proto",
          value: "~/Projects/myapp/proto/service/v1/service.proto",
        },
      ],
      cwd,
    );
    expect(importPaths).toEqual([
      resolve(homedir(), "Projects/googleapis"),
      homeProto,
    ]);
    expect(protoFiles).toEqual([
      resolve(homeProto, "service/v1/service.proto"),
    ]);
  });
});
