import { describe, expect, test } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as Protobuf from "protobufjs";
import { dirname, resolve } from "node:path";
import {
  grpcObjectFromRoot,
  packageDefinitionFromRoot,
  PROTO_LOADER_OPTIONS,
} from "./reflection";

const echoProto = resolve(
  import.meta.dirname,
  "../../../../../http-example-files/grpc/echopb/echo.proto",
);
const echoImportPath = dirname(echoProto);

describe("packageDefinitionFromRoot", () => {
  test("matches proto-loader output for a local proto file", async () => {
    const root = new Protobuf.Root();
    await root.load(echoProto, {
      alternateCommentMode: true,
      keepCase: true,
    });
    const fromRoot = packageDefinitionFromRoot(root);
    const fromLoader = protoLoader.loadSync(echoProto, {
      ...PROTO_LOADER_OPTIONS,
      includeDirs: [echoImportPath],
    });

    expect(Object.keys(fromRoot).sort()).toEqual(
      Object.keys(fromLoader).sort(),
    );

    const rootPkg = grpc.loadPackageDefinition(fromRoot) as grpc.GrpcObject;
    const loaderPkg = grpc.loadPackageDefinition(fromLoader) as grpc.GrpcObject;

    const rootService = (
      (rootPkg.grpc_echo as grpc.GrpcObject).v1 as grpc.GrpcObject
    ).EchoService as grpc.ServiceClientConstructor;
    const loaderService = (
      (loaderPkg.grpc_echo as grpc.GrpcObject).v1 as grpc.GrpcObject
    ).EchoService as grpc.ServiceClientConstructor;

    expect(Object.keys(rootService.service ?? {}).sort()).toEqual(
      Object.keys(loaderService.service ?? {}).sort(),
    );
  });

  test("grpcObjectFromRoot exposes service methods", async () => {
    const root = new Protobuf.Root();
    await root.load(echoProto, {
      alternateCommentMode: true,
      keepCase: true,
    });
    const pkg = grpcObjectFromRoot(root);
    const Client = ((pkg.grpc_echo as grpc.GrpcObject).v1 as grpc.GrpcObject)
      .EchoService as grpc.ServiceClientConstructor;

    expect(Object.keys(Client.service ?? {})).toContain("Echo");
  });
});
