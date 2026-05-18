import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { KulalaGrpcCommand, KulalaGrpcFlag } from "./types";
import {
  grpcFlagsToLoaderOptions,
  mergeGrpcFlags,
  parseGrpcSymbol,
  parseGrpcTarget,
} from "./parse-target";

export type GrpcNativeRequestOptions = {
  target: string;
  grpcCommand?: KulalaGrpcCommand;
  metadataFlags: KulalaGrpcFlag[];
  headers: Record<string, string>;
  body?: string;
  cwd: string;
  insecure?: boolean;
};

export type GrpcNativeResult = {
  statusCode: number;
  body: string;
  stderr: string;
  timings: { total: number };
};

/** protobufjs messages are not plain JSON; `JSON.stringify` alone often yields `{}`. */
export function serializeGrpcMessage(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "object") {
    const obj = value as { toObject?: (o?: object) => unknown };
    if (typeof obj.toObject === "function") {
      return JSON.stringify(
        obj.toObject({
          longs: String,
          enums: String,
          bytes: String,
          defaults: true,
          oneofs: true,
        }),
        grpcJsonReplacer,
        2,
      );
    }
  }
  try {
    return JSON.stringify(value, grpcJsonReplacer, 2);
  } catch {
    return String(value);
  }
}

function grpcJsonReplacer(_key: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  return v;
}

function buildCredentials(
  address: string,
  plaintext: boolean,
  insecure: boolean,
): grpc.ChannelCredentials {
  if (plaintext || insecure) {
    return grpc.credentials.createInsecure();
  }
  if (address.startsWith("localhost") || address.startsWith("127.0.0.1")) {
    return grpc.credentials.createInsecure();
  }
  return grpc.credentials.createSsl();
}

function metadataFromHeaders(headers: Record<string, string>): grpc.Metadata {
  const md = new grpc.Metadata();
  for (const [k, v] of Object.entries(headers)) {
    if (v === "") md.add(k, "");
    else md.add(k, v);
  }
  return md;
}

function loadPackageDefinition(
  flags: KulalaGrpcFlag[],
  cwd: string,
): grpc.GrpcObject {
  const { importPaths, protoFiles, protosetFiles } = grpcFlagsToLoaderOptions(
    flags,
    cwd,
  );

  if (protosetFiles.length > 0) {
    const buf = readFileSync(protosetFiles[0]!);
    const loader = protoLoader as typeof protoLoader & {
      loadProtoset?: (b: Buffer) => protoLoader.PackageDefinition;
    };
    if (typeof loader.loadProtoset !== "function") {
      throw new Error(
        "protoset files require @grpc/proto-loader with loadProtoset support",
      );
    }
    return grpc.loadPackageDefinition(loader.loadProtoset(buf));
  }

  if (protoFiles.length === 0) {
    throw new Error(
      "gRPC requires # @grpc-proto or -proto on the request (or a protoset file)",
    );
  }

  const def = protoLoader.loadSync(protoFiles, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: importPaths.length > 0 ? importPaths : [cwd],
  });
  return grpc.loadPackageDefinition(def);
}

function findServiceClient(
  pkg: grpc.GrpcObject,
  serviceName: string,
): grpc.ServiceClientConstructor | null {
  const parts = serviceName.split(".");
  let cur: grpc.GrpcObject | grpc.ServiceClientConstructor = pkg;
  for (const p of parts) {
    const next = (cur as grpc.GrpcObject)[p];
    if (!next) return null;
    cur = next as grpc.GrpcObject | grpc.ServiceClientConstructor;
  }
  if (typeof cur === "function") return cur as grpc.ServiceClientConstructor;
  return null;
}

async function grpcListServices(
  address: string,
  creds: grpc.ChannelCredentials,
): Promise<string> {
  try {
    const mod = await import("grpc-reflection-js");
    const ReflectionClient = mod.Client ?? mod.default;
    const reflection = new ReflectionClient(address, creds);
    const services: string[] = await reflection.listServices();
    return JSON.stringify(services, null, 2);
  } catch (e) {
    throw new Error(
      `gRPC server reflection failed (is reflection enabled on the server?): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

function describeFromPackage(pkg: grpc.GrpcObject, symbol?: string): string {
  const walk = (
    obj: grpc.GrpcObject,
    prefix: string,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (
        typeof v === "function" &&
        (v as grpc.ServiceClientConstructor).service
      ) {
        const svc = (v as grpc.ServiceClientConstructor).service;
        out[path] = Object.keys(svc);
      } else if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
        Object.assign(out, walk(v as grpc.GrpcObject, path));
      }
    }
    return out;
  };

  let result = walk(pkg, "");
  if (symbol) {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result)) {
      if (k.includes(symbol) || k.endsWith(`.${symbol}`)) {
        filtered[k] = v;
      }
    }
    result = Object.keys(filtered).length > 0 ? filtered : result;
  }
  return JSON.stringify(result, null, 2);
}

function resolveClientMethod(
  Client: grpc.ServiceClientConstructor,
  methodName: string,
): string {
  const names = Object.keys(Client.service ?? {});
  if (names.includes(methodName)) return methodName;
  const lower = methodName.toLowerCase();
  const hit = names.find((n) => n.toLowerCase() === lower);
  if (hit) return hit;
  throw new Error(
    `Method not found on service: ${methodName} (available: ${names.join(", ")})`,
  );
}

function unaryCall(
  Client: grpc.ServiceClientConstructor,
  methodName: string,
  address: string,
  creds: grpc.ChannelCredentials,
  metadata: grpc.Metadata,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const client = new Client(address, creds) as grpc.Client &
    Record<string, unknown>;
  const rpcName = resolveClientMethod(Client, methodName);
  const rpc = client[rpcName];
  if (typeof rpc !== "function") {
    client.close();
    return Promise.reject(new Error(`gRPC client method missing: ${rpcName}`));
  }

  return new Promise((resolve, reject) => {
    (
      rpc as (
        req: Record<string, unknown>,
        md: grpc.Metadata,
        cb: (err: grpc.ServiceError | null, res: unknown) => void,
      ) => void
    ).call(client, payload, metadata, (err, response) => {
      client.close();
      if (err) reject(err);
      else resolve(response);
    });
  });
}

export async function grpcNativeRequest(
  opts: GrpcNativeRequestOptions,
): Promise<GrpcNativeResult> {
  const t0 = performance.now();
  const parsed = opts.grpcCommand ?? parseGrpcTarget(opts.target);
  const flags = mergeGrpcFlags(opts.metadataFlags, parsed.inlineFlags);
  const { plaintext } = grpcFlagsToLoaderOptions(flags, opts.cwd);
  const insecure = opts.insecure === true || plaintext;
  const address = parsed.address;
  if (!address) {
    throw new Error("gRPC request is missing server address (host:port)");
  }

  const creds = buildCredentials(address, plaintext, insecure);
  const metadata = metadataFromHeaders(opts.headers);

  try {
    if (parsed.command === "list") {
      const body = await grpcListServices(address, creds);
      return {
        statusCode: 200,
        body,
        stderr: "",
        timings: { total: performance.now() - t0 },
      };
    }

    if (parsed.command === "describe") {
      const pkg = loadPackageDefinition(flags, opts.cwd);
      const body = describeFromPackage(pkg, parsed.symbol);
      return {
        statusCode: 200,
        body,
        stderr: "",
        timings: { total: performance.now() - t0 },
      };
    }

    if (!parsed.symbol) {
      throw new Error(
        "gRPC request requires service.method (e.g. helloworld.Greeter/SayHello)",
      );
    }

    const { serviceName, methodName } = parseGrpcSymbol(parsed.symbol);
    const pkg = loadPackageDefinition(flags, opts.cwd);
    const Client = findServiceClient(pkg, serviceName);
    if (!Client) {
      throw new Error(`gRPC service not found in proto: ${serviceName}`);
    }

    let payload: Record<string, unknown> = {};
    if (opts.body && opts.body.trim()) {
      payload = JSON.parse(opts.body) as Record<string, unknown>;
    }

    const response = await unaryCall(
      Client,
      methodName,
      address,
      creds,
      metadata,
      payload,
    );

    return {
      statusCode: 200,
      body: serializeGrpcMessage(response),
      stderr: "",
      timings: { total: performance.now() - t0 },
    };
  } catch (e) {
    const err = e as grpc.ServiceError & { message?: string };
    const msg = err.message ?? String(e);
    const code = typeof err.code === "number" ? err.code : 2;
    return {
      statusCode: code === 0 ? 500 : code,
      body: msg,
      stderr: msg,
      timings: { total: performance.now() - t0 },
    };
  }
}
