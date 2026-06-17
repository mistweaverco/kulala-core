import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as descriptor from "protobufjs/ext/descriptor";
import type { Root } from "protobufjs";

export const PROTO_LOADER_OPTIONS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
} as const;

type DescriptorRoot = Root & {
  resolveAll(): void;
  toDescriptor(syntax: string): { [k: string]: unknown };
};

type ReflectionClient = {
  listServices(): Promise<string[]>;
  fileContainingSymbol(symbol: string): Promise<Root>;
};

export async function createReflectionClient(
  address: string,
  creds: grpc.ChannelCredentials,
  metadata?: grpc.Metadata,
): Promise<ReflectionClient> {
  const mod = await import("grpc-reflection-js");
  const ReflectionClientCtor = mod.Client ?? mod.default;
  return new ReflectionClientCtor(
    address,
    creds,
    undefined,
    metadata,
  ) as unknown as ReflectionClient;
}

export function packageDefinitionFromRoot(
  root: Root,
): protoLoader.PackageDefinition {
  const descriptorRoot = root as DescriptorRoot;
  descriptorRoot.resolveAll();
  const descriptorSet = descriptorRoot.toDescriptor("proto3");
  const buf = Buffer.from(
    descriptor.FileDescriptorSet.encode(descriptorSet).finish(),
  );
  return protoLoader.loadFileDescriptorSetFromBuffer(buf, PROTO_LOADER_OPTIONS);
}

export function grpcObjectFromRoot(root: Root): grpc.GrpcObject {
  return grpc.loadPackageDefinition(packageDefinitionFromRoot(root));
}

export async function loadPackageFromReflection(
  address: string,
  creds: grpc.ChannelCredentials,
  symbol: string,
  metadata?: grpc.Metadata,
): Promise<grpc.GrpcObject> {
  try {
    const client = await createReflectionClient(address, creds, metadata);
    const root = await client.fileContainingSymbol(symbol);
    return grpcObjectFromRoot(root);
  } catch (e) {
    throw new Error(
      `gRPC server reflection failed for "${symbol}" (is reflection enabled on the server?): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

export async function listServicesViaReflection(
  address: string,
  creds: grpc.ChannelCredentials,
  metadata?: grpc.Metadata,
): Promise<string[]> {
  try {
    const client = await createReflectionClient(address, creds, metadata);
    return await client.listServices();
  } catch (e) {
    throw new Error(
      `gRPC server reflection failed (is reflection enabled on the server?): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

function isReflectionServiceName(name: string): boolean {
  return name.startsWith("grpc.reflection");
}

export async function describeViaReflection(
  address: string,
  creds: grpc.ChannelCredentials,
  describeFromPackage: (pkg: grpc.GrpcObject, symbol?: string) => string,
  symbol?: string,
  metadata?: grpc.Metadata,
): Promise<string> {
  const client = await createReflectionClient(address, creds, metadata);

  if (symbol) {
    const root = await client.fileContainingSymbol(symbol);
    const pkg = grpcObjectFromRoot(root);
    return describeFromPackage(pkg, symbol);
  }

  const services = (await client.listServices()).filter(
    (name) => !isReflectionServiceName(name),
  );
  const merged: Record<string, unknown> = {};
  for (const serviceName of services) {
    try {
      const root = await client.fileContainingSymbol(serviceName);
      const pkg = grpcObjectFromRoot(root);
      const partial = JSON.parse(
        describeFromPackage(pkg, serviceName),
      ) as Record<string, unknown>;
      Object.assign(merged, partial);
    } catch {
      // Skip services the server cannot describe via reflection.
    }
  }
  return JSON.stringify(merged, null, 2);
}
