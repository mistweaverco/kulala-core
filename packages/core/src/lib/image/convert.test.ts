import { describe, expect, test } from "bun:test";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { convertImage } from "./convert";

function makePngBase64(width = 2, height = 2): string {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png).toString("base64");
}

function makeJpegBase64(width = 2, height = 2): string {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 255;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  return jpeg.encode({ data, width, height }, 90).data.toString("base64");
}

describe("convertImage", () => {
  test("passes through PNG without conversion", () => {
    const content = makePngBase64();
    const result = convertImage({
      content,
      mediaType: "image/png",
      target: "png",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe(content);
    expect(result.mediaType).toBe("image/png");
    expect(result.convertedFrom).toBeUndefined();
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test("detects PNG via magic when mediaType is missing", () => {
    const content = makePngBase64();
    const result = convertImage({ content, target: "png" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mediaType).toBe("image/png");
    expect(result.convertedFrom).toBeUndefined();
  });

  test("converts JPEG to PNG", () => {
    const content = makeJpegBase64();
    const result = convertImage({
      content,
      mediaType: "image/jpeg",
      target: "png",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mediaType).toBe("image/png");
    expect(result.convertedFrom).toBe("jpeg");
    expect(result.content.startsWith("iVBORw0KGgo")).toBe(true);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test("detects JPEG via magic when mediaType is missing", () => {
    const content = makeJpegBase64();
    const result = convertImage({ content, target: "png" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.convertedFrom).toBe("jpeg");
  });

  test("rejects unsupported formats", () => {
    // Minimal WebP-like base64 that is neither PNG nor JPEG magic.
    const result = convertImage({
      content: Buffer.from("RIFF....WEBP").toString("base64"),
      mediaType: "image/webp",
      target: "png",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Cannot convert");
  });

  test("rejects empty content", () => {
    const result = convertImage({ content: "", target: "png" });
    expect(result.ok).toBe(false);
  });
});
