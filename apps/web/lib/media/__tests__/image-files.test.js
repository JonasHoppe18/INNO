import { describe, expect, it } from "vitest";
import {
  MEDIA_MAX_BYTES,
  MEDIA_MAX_UPLOAD_BYTES,
  detectImageType,
  readImageDimensions,
  validateMediaFile,
} from "../image-files";

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n) => [(n >> 8) & 255, n & 255];
const u16le = (n) => [n & 255, (n >> 8) & 255];

const png = (width, height) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 2, 0, 0, 0]);
const gif = (width, height, version = "89a") =>
  new Uint8Array([...Buffer.from(`GIF${version}`), ...u16le(width), ...u16le(height), 0, 0, 0]);
// SOI, an APP0 segment to skip, then a frame header (SOF0 baseline or SOF2 progressive).
const jpeg = (width, height, marker = 0xc0) =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...u16be(16), ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, marker, ...u16be(17), 8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

describe("detectImageType", () => {
  it("recognizes PNG, JPEG and both GIF versions by their bytes", () => {
    expect(detectImageType(png(1, 1))).toBe("image/png");
    expect(detectImageType(jpeg(1, 1))).toBe("image/jpeg");
    expect(detectImageType(gif(1, 1, "87a"))).toBe("image/gif");
    expect(detectImageType(gif(1, 1, "89a"))).toBe("image/gif");
  });

  it("does not recognize SVG, WebP or empty files", () => {
    expect(detectImageType(new Uint8Array(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")))).toBeNull();
    expect(detectImageType(new Uint8Array(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe("validateMediaFile", () => {
  it("accepts a file whose bytes match its type", () => {
    expect(validateMediaFile({ contentType: "image/gif", bytes: gif(2, 2) }))
      .toEqual({ contentType: "image/gif", extension: "gif" });
    expect(validateMediaFile({ contentType: "IMAGE/JPEG", bytes: jpeg(2, 2) }))
      .toEqual({ contentType: "image/jpeg", extension: "jpg" });
  });

  it("accepts large photos that will be compressed, but not large GIFs", () => {
    const bigJpeg = new Uint8Array(MEDIA_MAX_BYTES + 10);
    bigJpeg.set([0xff, 0xd8, 0xff]);
    expect(validateMediaFile({ contentType: "image/jpeg", bytes: bigJpeg }).contentType).toBe("image/jpeg");
  });

  it("rejects unsupported types, mismatched bytes, empty and oversized files", () => {
    const reject = (input, message) => {
      let error;
      try { validateMediaFile(input); } catch (caught) { error = caught; }
      expect(error?.message).toContain(message);
      expect(error?.status).toBe(400);
    };
    reject({ contentType: "image/svg+xml", bytes: new Uint8Array([1]) }, "PNG, JPG or GIF");
    reject({ contentType: "image/webp", bytes: new Uint8Array([1]) }, "PNG, JPG or GIF");
    reject({ contentType: "image/png", bytes: gif(1, 1) }, "does not match");
    reject({ contentType: "image/png", bytes: new Uint8Array() }, "empty");
    reject({ contentType: "image/gif", bytes: new Uint8Array(MEDIA_MAX_BYTES + 1) }, "GIFs must be 5 MB");
    reject({ contentType: "image/png", bytes: new Uint8Array(MEDIA_MAX_UPLOAD_BYTES + 1) }, "15 MB");
  });
});

describe("readImageDimensions", () => {
  it("reads width and height from PNG, GIF and baseline or progressive JPEG", () => {
    expect(readImageDimensions(png(640, 120), "image/png")).toEqual({ width: 640, height: 120 });
    expect(readImageDimensions(gif(300, 250), "image/gif")).toEqual({ width: 300, height: 250 });
    expect(readImageDimensions(jpeg(1200, 800), "image/jpeg")).toEqual({ width: 1200, height: 800 });
    expect(readImageDimensions(jpeg(64, 48, 0xc2), "image/jpeg")).toEqual({ width: 64, height: 48 });
  });

  it("returns null when the header is cut short", () => {
    expect(readImageDimensions(png(1, 1).slice(0, 12), "image/png")).toBeNull();
    expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
  });
});
