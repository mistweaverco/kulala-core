import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { KulalaGrpcCommand, KulalaGrpcFlag } from "./types";
import {
  grpcChannelOptionsForAuthority,
  grpcFlagsToLoaderOptions,
  mergeGrpcFlags,
  parseGrpcAddress,
  parseGrpcSymbol,
  parseGrpcTarget,
} from "./parse-target";
import {
  describeViaReflection,
  listServicesViaReflection,
  loadPackageFromReflection,
  PROTO_LOADER_OPTIONS,
} from "./reflection";

export type GrpcNativeRequestOptions = {
  target: string;
  grpcCommand?: KulalaGrpcCommand;
  metadataFlags: KulalaGrpcFlag[];
  headers: Record<string, string>;
  body?: string;
  cwd: string;
  vars?: Record<string, string>;
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
): grpc.ChannelCredentials {
  if (plaintext) {
    return grpc.credentials.createInsecure();
  }
  const { useTls } = parseGrpcAddress(address);
  if (!useTls) {
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

type LoadPackageContext = {
  flags: KulalaGrpcFlag[];
  cwd: string;
  vars?: Record<string, string>;
  address?: string;
  creds?: grpc.ChannelCredentials;
  metadata?: grpc.Metadata;
  channelOptions?: Record<string, string>;
  reflectionSymbol?: string;
};

function hasLocalDescriptors(
  flags: KulalaGrpcFlag[],
  cwd: string,
  vars: Record<string, string>,
): boolean {
  const { protoFiles, protosetFiles } = grpcFlagsToLoaderOptions(
    flags,
    cwd,
    vars,
  );
  return protoFiles.length > 0 || protosetFiles.length > 0;
}

async function loadPackageDefinition(
  ctx: LoadPackageContext,
): Promise<grpc.GrpcObject> {
  const vars = ctx.vars ?? {};
  const { importPaths, protoFiles, protosetFiles } = grpcFlagsToLoaderOptions(
    ctx.flags,
    ctx.cwd,
    vars,
  );

  if (protosetFiles.length > 0) {
    const buf = readFileSync(protosetFiles[0]!);
    const def = protoLoader.loadFileDescriptorSetFromBuffer(
      buf,
      PROTO_LOADER_OPTIONS,
    );
    return grpc.loadPackageDefinition(def);
  }

  if (protoFiles.length > 0) {
    const def = protoLoader.loadSync(protoFiles, {
      ...PROTO_LOADER_OPTIONS,
      includeDirs: importPaths.length > 0 ? importPaths : [ctx.cwd],
    });
    return grpc.loadPackageDefinition(def);
  }

  if (!ctx.address || !ctx.creds) {
    throw new Error(
      "gRPC requires # @grpc-proto or -proto on the request (or a protoset file), or a server address with reflection enabled",
    );
  }
  if (!ctx.reflectionSymbol) {
    throw new Error(
      "gRPC reflection requires a service symbol (e.g. helloworld.Greeter/SayHello)",
    );
  }

  return loadPackageFromReflection(
    ctx.address,
    ctx.creds,
    ctx.reflectionSymbol,
    ctx.metadata,
    ctx.channelOptions,
  );
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
  metadata: grpc.Metadata,
  channelOptions?: Record<string, string>,
): Promise<string> {
  const services = await listServicesViaReflection(
    address,
    creds,
    metadata,
    channelOptions,
  );
  return JSON.stringify(services, null, 2);
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
  channelOptions?: Record<string, string>,
): Promise<unknown> {
  const client = new Client(address, creds, channelOptions) as grpc.Client &
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
  const vars = opts.vars ?? {};
  const { plaintext, authority } = grpcFlagsToLoaderOptions(
    flags,
    opts.cwd,
    vars,
  );
  const channelOptions = grpcChannelOptionsForAuthority(authority);
  const address = parsed.address;
  if (!address) {
    throw new Error("gRPC request is missing server address (host:port)");
  }

  const { channelTarget } = parseGrpcAddress(address);
  const creds = buildCredentials(address, plaintext);
  const metadata = metadataFromHeaders(opts.headers);

  try {
    if (parsed.command === "list") {
      const body = await grpcListServices(
        channelTarget,
        creds,
        metadata,
        channelOptions,
      );
      return {
        statusCode: 200,
        body,
        stderr: "",
        timings: { total: performance.now() - t0 },
      };
    }

    const loadCtx = {
      flags,
      cwd: opts.cwd,
      vars,
      address: channelTarget,
      creds,
      metadata,
      channelOptions,
    };

    if (parsed.command === "describe") {
      const body = hasLocalDescriptors(flags, opts.cwd, vars)
        ? describeFromPackage(
            await loadPackageDefinition(loadCtx),
            parsed.symbol,
          )
        : await describeViaReflection(
            channelTarget,
            creds,
            describeFromPackage,
            parsed.symbol,
            metadata,
            channelOptions,
          );
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
    let pkg = await loadPackageDefinition({
      ...loadCtx,
      reflectionSymbol: serviceName,
    });
    let Client = findServiceClient(pkg, serviceName);
    if (!Client && hasLocalDescriptors(flags, opts.cwd, vars)) {
      pkg = await loadPackageFromReflection(
        channelTarget,
        creds,
        serviceName,
        metadata,
        channelOptions,
      );
      Client = findServiceClient(pkg, serviceName);
    }
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
      channelTarget,
      creds,
      metadata,
      payload,
      channelOptions,
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
