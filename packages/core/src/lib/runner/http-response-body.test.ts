import { describe, expect, test } from "bun:test";
import {
  buildRunnerResponseBody,
  formatXmlBody,
  isXmlMediaType,
  primaryMediaType,
} from "./http-response-body";

describe("primaryMediaType", () => {
  test("strips parameters and lowercases", () => {
    expect(primaryMediaType("application/xml;charset=UTF-8")).toBe(
      "application/xml",
    );
    expect(primaryMediaType("Application/JSON")).toBe("application/json");
  });

  test("returns empty string for blank input", () => {
    expect(primaryMediaType("")).toBe("");
    expect(primaryMediaType("   ")).toBe("");
  });
});

describe("isXmlMediaType", () => {
  test("matches common XML MIME types", () => {
    expect(isXmlMediaType("application/xml")).toBe(true);
    expect(isXmlMediaType("text/xml")).toBe(true);
    expect(isXmlMediaType("application/atom+xml")).toBe(true);
  });

  test("rejects non-XML MIME types", () => {
    expect(isXmlMediaType("application/json")).toBe(false);
    expect(isXmlMediaType("text/plain")).toBe(false);
    expect(isXmlMediaType("")).toBe(false);
  });
});

describe("formatXmlBody", () => {
  test("returns input unchanged for blank content", () => {
    expect(formatXmlBody("   ")).toBe("   ");
  });

  test("returns input unchanged on invalid XML", () => {
    const invalid = "<root><unclosed>";
    expect(formatXmlBody(invalid)).toBe(invalid);
  });

  test("formats valid XML with indentation", () => {
    const formatted = formatXmlBody("<root><item/></root>");
    expect(formatted).toContain("<root>");
    expect(formatted).toContain("<item");
    expect(formatted).toContain("\n");
    expect(formatted).not.toBe("<root><item/></root>");
  });

  test("preserves XML declaration when present", () => {
    const formatted = formatXmlBody(
      '<?xml version="1.0"?><root><item id="1"/></root>',
    );
    expect(formatted.startsWith('<?xml version="1.0"?>')).toBe(true);
    expect(formatted).toContain('id="1"');
  });
});

describe("buildRunnerResponseBody", () => {
  test("parses JSON when content-type includes json", () => {
    const body = buildRunnerResponseBody('{"ok":true}', "application/json");
    expect(body).toEqual({ type: "json", content: { ok: true } });
  });

  test("keeps invalid JSON as text with mediaType", () => {
    const body = buildRunnerResponseBody("{not json", "application/json");
    expect(body).toEqual({
      type: "text",
      content: "{not json",
      mediaType: "application/json",
    });
  });

  test("formats XML as text with mediaType", () => {
    const xml = "<root><item/></root>";
    const body = buildRunnerResponseBody(xml, "application/xml;charset=UTF-8");

    expect(body).toEqual({
      type: "text",
      content: formatXmlBody(xml),
      mediaType: "application/xml",
    });
  });

  test("omits mediaType when content-type is missing", () => {
    const body = buildRunnerResponseBody("plain", "");
    expect(body).toEqual({ type: "text", content: "plain" });
  });
});
