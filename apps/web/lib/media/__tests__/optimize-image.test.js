import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MEDIA_MAX_WIDTH, optimizeMediaImage } from "../optimize-image";

const solid = (width, height, format, options = {}) =>
  sharp({ create: { width, height, channels: 3, background: { r: 225, g: 29, b: 72 } } })
    .withMetadata(options.exif ? { exif: { IFD0: { Copyright: "Secret place" } } } : {})
    [format]()
    .toBuffer();

describe("optimizeMediaImage", () => {
  it("scales wide photos down to the email maximum and keeps the aspect ratio", async () => {
    const input = await solid(3000, 1500, "jpeg");
    const result = await optimizeMediaImage(new Uint8Array(input), "image/jpeg");
    expect(result.width).toBe(MEDIA_MAX_WIDTH);
    expect(result.height).toBe(600);
    expect(result.contentType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(result.bytes)).metadata();
    expect(meta.width).toBe(MEDIA_MAX_WIDTH);
  });

  it("removes photo metadata such as location from JPEGs", async () => {
    const input = await solid(200, 100, "jpeg", { exif: true });
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await optimizeMediaImage(new Uint8Array(input), "image/jpeg");
    expect((await sharp(Buffer.from(result.bytes)).metadata()).exif).toBeUndefined();
  });

  it("leaves small PNGs untouched", async () => {
    const input = new Uint8Array(await solid(160, 40, "png"));
    const result = await optimizeMediaImage(input, "image/png");
    expect(result.bytes).toBe(input);
    expect(result).toMatchObject({ width: 160, height: 40, contentType: "image/png" });
  });

  it("scales wide PNGs down and keeps them PNG for transparency", async () => {
    const input = await solid(2400, 800, "png");
    const result = await optimizeMediaImage(new Uint8Array(input), "image/png");
    expect(result).toMatchObject({ width: MEDIA_MAX_WIDTH, height: 400, contentType: "image/png" });
  });

  it("never re-encodes GIFs, so animations survive", async () => {
    const input = new Uint8Array([...Buffer.from("GIF89a"), 0x10, 0x27, 0x10, 0x27, 0, 0, 0]);
    const result = await optimizeMediaImage(input, "image/gif");
    expect(result.bytes).toBe(input);
    expect(result).toMatchObject({ width: 10000, height: 10000, contentType: "image/gif" });
  });
});
