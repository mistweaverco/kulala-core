import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { formatHttp } from "./format";

const exampleDir = join(import.meta.dir, "../../../../../http-example-files");

describe("formatHttp", () => {
  test("formats simple.http successfully", async () => {
    const content = readFileSync(join(exampleDir, "simple.http"), "utf-8");
    const result = await formatHttp(content, join(exampleDir, "simple.http"), {
      formatBody: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted.length).toBeGreaterThan(0);
      expect(result.formatted).toContain("###");
    }
  });

  test("returns error for documents with parse errors", async () => {
    const result = await formatHttp(
      `import ./nonexistent.http

### MAIN_BLOCK

POST https://example.com/post HTTP/1.1
`,
      undefined,
      { formatBody: false },
    );
    expect(result.success).toBe(false);
  });

  test("respects bodyFormat.indent for JSON bodies without Content-Type", async () => {
    const content = `### MOO
POST https://httpbin.org/get?foo=bar HTTP/1.1
Accept: application/json

{
  "foo": "bar"
}
`;
    const result = await formatHttp(content, undefined, {
      formatBody: true,
      bodyFormat: { indent: 8, line_width: 80, expand_tabs: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain('        "foo": "bar"');
    }
  });

  test("adds default http version on the same line for simple requests", async () => {
    const content = `### MOO
POST https://httpbin.org/get?foo=bar
Accept: application/json
`;
    const result = await formatHttp(content, undefined, {
      formatBody: false,
      defaults: { http_version: "HTTP/1.1" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain(
        "POST https://httpbin.org/get?foo=bar HTTP/1.1",
      );
      expect(result.formatted).not.toMatch(
        /POST https:\/\/httpbin\.org\/get\?foo=bar\n\s+HTTP\/1\.1/,
      );
    }
  });

  test("omits http version when defaults.http_version is false", async () => {
    const content = `### FOO
GET https://httpbin.org/get?foo=bar HTTP/1.1
Accept: application/json

### MOO
POST https://httpbin.org/get?foo=bar
Accept: application/json
`;
    const result = await formatHttp(content, undefined, {
      formatBody: false,
      defaults: { http_version: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain(
        "GET https://httpbin.org/get?foo=bar\nAccept:",
      );
      expect(result.formatted).toContain(
        "POST https://httpbin.org/get?foo=bar\nAccept:",
      );
      expect(result.formatted).not.toContain("HTTP/1.1");
      expect(result.formatted).not.toContain("HTTP/2");
    }
  });

  test("expand_tabs false indents JSON bodies with tab characters", async () => {
    const content = `### MOO
POST https://example.com

{
  "foo": "bar"
}
`;
    const result = await formatHttp(content, undefined, {
      formatBody: true,
      bodyFormat: { indent: 4, line_width: 80, expand_tabs: false },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain('\t"foo": "bar"');
      expect(result.formatted).not.toMatch(/\n {4}"foo": "bar"/);
    }
  });

  test("expand_tabs true converts literal tabs in JSON bodies to spaces", async () => {
    const content = `### MOO
POST https://example.com

{
\t"foo": "bar"
}
`;
    const result = await formatHttp(content, undefined, {
      formatBody: true,
      bodyFormat: { indent: 4, line_width: 80, expand_tabs: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain('    "foo": "bar"');
      expect(result.formatted).not.toContain('\t"foo"');
    }
  });

  test("formatBody false preserves original JSON body text", async () => {
    const content = `### MOO
POST https://example.com

{
    "foo": "bar"
}
`;
    const withBody = await formatHttp(content, undefined, {
      formatBody: true,
      bodyFormat: { indent: 2, line_width: 80, expand_tabs: true },
    });
    const withoutBody = await formatHttp(content, undefined, {
      formatBody: false,
    });
    expect(withBody.success).toBe(true);
    expect(withoutBody.success).toBe(true);
    if (withBody.success && withoutBody.success) {
      expect(withBody.formatted).toContain('  "foo": "bar"');
      expect(withoutBody.formatted).toContain('    "foo": "bar"');
    }
  });
});
