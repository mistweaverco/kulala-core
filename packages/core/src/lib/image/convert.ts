import jpeg from "jpeg-js";
import { PNG } from "pngjs";

export type ConvertImageTarget = "png";

export type ConvertImageInput = {
  /** Base64-encoded image bytes. */
  content: string;
  mediaType?: string;
  target: ConvertImageTarget;
};

export type ConvertImageResult =
  | {
      ok: true;
      content: string;
      mediaType: string;
      byteLength: number;
      convertedFrom?: "jpeg";
    }
  | { ok: false; error: string };

function isPngBase64(content: string, mediaType?: string): boolean {
  const mt = mediaType?.toLowerCase() ?? "";
  if (mt === "image/png") return true;
  return content.startsWith("iVBORw0KGgo");
}

function isJpegBase64(content: string, mediaType?: string): boolean {
  const mt = mediaType?.toLowerCase() ?? "";
  if (mt === "image/jpeg" || mt === "image/jpg") return true;
  return content.startsWith("/9j/");
}

function convertJpegBase64ToPngBase64(base64: string): string | null {
  try {
    const decoded = jpeg.decode(Buffer.from(base64, "base64"));
    const png = new PNG({ width: decoded.width, height: decoded.height });
    png.data = decoded.data;
    return PNG.sync.write(png).toString("base64");
  } catch {
    return null;
  }
}

/**
 * Convert an image to a terminal-friendly format.
 * Currently only `target: "png"` is supported (Kitty graphics requires PNG / f=100).
 */
export function convertImage(input: ConvertImageInput): ConvertImageResult {
  if (input.target !== "png") {
    return {
      ok: false,
      error: `Unsupported convert_image target: ${input.target}`,
    };
  }
  if (!input.content || typeof input.content !== "string") {
    return { ok: false, error: "convert_image requires base64 content" };
  }

  if (isPngBase64(input.content, input.mediaType)) {
    const buf = Buffer.from(input.content, "base64");
    return {
      ok: true,
      content: input.content,
      mediaType: "image/png",
      byteLength: buf.byteLength,
    };
  }

  if (isJpegBase64(input.content, input.mediaType)) {
    const pngBase64 = convertJpegBase64ToPngBase64(input.content);
    if (!pngBase64) {
      return { ok: false, error: "Failed to convert JPEG to PNG" };
    }
    const buf = Buffer.from(pngBase64, "base64");
    return {
      ok: true,
      content: pngBase64,
      mediaType: "image/png",
      byteLength: buf.byteLength,
      convertedFrom: "jpeg",
    };
  }

  const mediaType = input.mediaType ?? "application/octet-stream";
  return {
    ok: false,
    error: `Cannot convert ${mediaType} to PNG (only JPEG and PNG are supported)`,
  };
}
