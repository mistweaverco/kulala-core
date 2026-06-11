import { describe, expect, test } from "bun:test";
import {
  buildRunnerResponseBody,
  formatJsonValue,
  formatXmlBody,
  isXmlMediaType,
  primaryMediaType,
  resolveResponseFormatOptions,
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

describe("formatJsonValue", () => {
  test("defaults to 2-space indentation", () => {
    expect(formatJsonValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  test("uses tabs when expand_tabs is false", () => {
    const formatted = formatJsonValue({ a: 1 }, { expand_tabs: false });
    expect(formatted).toContain('\t"a": 1');
    expect(formatted).not.toContain('  "a": 1');
  });

  test("sorts keys when sort_keys is true", () => {
    const formatted = formatJsonValue({ b: 2, a: 1 }, { sort_keys: true });
    expect(formatted.indexOf('"a"')).toBeLessThan(formatted.indexOf('"b"'));
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

  test("uses tabs when expand_tabs is false", () => {
    const formatted = formatXmlBody("<root><item/></root>", {
      expand_tabs: false,
    });
    expect(formatted).toContain("\n\t");
  });
});

describe("resolveResponseFormatOptions", () => {
  test("applies defaults when options are omitted", () => {
    expect(resolveResponseFormatOptions()).toEqual({
      indent: 2,
      expand_tabs: true,
      sort_keys: false,
    });
  });
});

describe("buildRunnerResponseBody", () => {
  test("parses JSON when content-type includes json", async () => {
    const body = await buildRunnerResponseBody(
      '{"ok":true}',
      "application/json",
    );
    expect(body).toEqual({
      type: "json",
      content: { ok: true },
      formatted: '{\n  "ok": true\n}',
    });
  });

  test("keeps invalid JSON as text with mediaType", async () => {
    const body = await buildRunnerResponseBody("{not json", "application/json");
    expect(body).toEqual({
      type: "text",
      content: "{not json",
      mediaType: "application/json",
    });
  });

  test("formats XML as text with mediaType", async () => {
    const xml = "<root><item/></root>";
    const body = await buildRunnerResponseBody(
      xml,
      "application/xml;charset=UTF-8",
    );

    expect(body).toEqual({
      type: "text",
      content: formatXmlBody(xml),
      mediaType: "application/xml",
    });
  });

  test("omits mediaType when content-type is missing", async () => {
    const body = await buildRunnerResponseBody("plain", "");
    expect(body).toEqual({ type: "text", content: "plain" });
  });

  test("respects client indent for JSON", async () => {
    const body = await buildRunnerResponseBody(
      '{"ok":true}',
      "application/json",
      {
        indent: 4,
        expand_tabs: true,
      },
    );
    expect(body).toEqual({
      type: "json",
      content: { ok: true },
      formatted: '{\n    "ok": true\n}',
    });
  });
});
