import sharp from "sharp";
import { MEDIA_WARN_BYTES, readImageDimensions } from "./image-files";

// Twice the 600px email width, so images stay sharp on high-density screens.
export const MEDIA_MAX_WIDTH = 1200;

async function reencode(bytes, contentType) {
  const pipeline = sharp(Buffer.from(bytes))
    .rotate()
    .resize({ width: MEDIA_MAX_WIDTH, withoutEnlargement: true });
  const encoded = contentType === "image/jpeg"
    ? pipeline.jpeg({ quality: 82, mozjpeg: true })
    : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), contentType, width: info.width, height: info.height };
}

// Makes uploads email-friendly. JPEGs are always re-encoded, which also strips
// photo metadata such as GPS location and applies the camera rotation. PNGs are
// only re-encoded when wide or heavy. GIFs are never touched, so animations survive.
export async function optimizeMediaImage(bytes, contentType) {
  const dimensions = readImageDimensions(bytes, contentType);
  const original = { bytes, contentType, width: dimensions?.width ?? null, height: dimensions?.height ?? null };
  if (contentType === "image/gif") return original;
  if (contentType === "image/png") {
    const wide = (dimensions?.width ?? 0) > MEDIA_MAX_WIDTH;
    if (!wide && bytes.length <= MEDIA_WARN_BYTES) return original;
    const optimized = await reencode(bytes, contentType);
    return wide || optimized.bytes.length < bytes.length ? optimized : original;
  }
  return reencode(bytes, contentType);
}
