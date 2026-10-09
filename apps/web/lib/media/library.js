import { MEDIA_WARN_BYTES } from "./image-files";

export function formatMediaSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

export const isLargeMedia = (bytes) => Number(bytes) > MEDIA_WARN_BYTES;

export function mediaAltText(fileName) {
  return String(fileName || "").replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
}

// Uploads are prepended locally, so a later page can contain images already shown.
export function appendMediaPage(shown, page) {
  const seen = new Set(shown.map((item) => item.id));
  return [...shown, ...page.filter((item) => !seen.has(item.id))];
}
