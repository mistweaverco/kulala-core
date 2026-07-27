import { describe, expect, test } from "bun:test";
import {
  formatWsDisplayStream,
  normalizeSentPayload,
  wsMessagePayloads,
} from "./display";

describe("formatWsDisplayStream", () => {
  test("prefixes incoming and outgoing messages", () => {
    expect(
      formatWsDisplayStream([
        { direction: "in", data: "Request served by 6e82931b755587" },
        { direction: "in", data: '{"name":"world"}' },
        { direction: "out", data: '{"foo": 1}' },
      ]),
    ).toBe(
      [
        "<-- Request served by 6e82931b755587",
        '<-- {"name":"world"}',
        '--> {"foo": 1}',
      ].join("\n"),
    );
  });

  test("returns empty string for no messages", () => {
    expect(formatWsDisplayStream([])).toBe("");
  });
});

describe("wsMessagePayloads", () => {
  test("extracts raw payloads in order", () => {
    expect(
      wsMessagePayloads([
        { direction: "out", data: "hello" },
        { direction: "in", data: "world" },
      ]),
    ).toEqual(["hello", "world"]);
  });
});

describe("normalizeSentPayload", () => {
  test("strips a single trailing newline", () => {
    expect(normalizeSentPayload('{"a":1}\n')).toBe('{"a":1}');
    expect(normalizeSentPayload('{"a":1}')).toBe('{"a":1}');
  });
});
