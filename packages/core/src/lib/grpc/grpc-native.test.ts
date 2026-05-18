import { describe, expect, test } from "bun:test";
import { serializeGrpcMessage } from "./grpc-native";

describe("serializeGrpcMessage", () => {
  test("serializes plain objects", () => {
    const json = serializeGrpcMessage({ body: "hello", headers: { a: "b" } });
    expect(JSON.parse(json)).toEqual({ body: "hello", headers: { a: "b" } });
  });

  test("uses toObject for protobufjs messages", () => {
    const message = {
      toObject() {
        return { body: "from-server", remote_addr: "127.0.0.1" };
      },
    };
    const json = serializeGrpcMessage(message);
    expect(JSON.parse(json)).toEqual({
      body: "from-server",
      remote_addr: "127.0.0.1",
    });
  });

  test("returns empty string for undefined", () => {
    expect(serializeGrpcMessage(undefined)).toBe("");
  });
});
