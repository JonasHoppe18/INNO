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

// New image blocks start at full width, which stretches small images such as
// logos. After a pick, the block with that image gets the image's own width,
// capped at the email width.
export function fitPickedImageWidth(content, { url, width }) {
  const emailWidth = Number(content?.settings?.width) || 600;
  if (!url || !(width > 0) || width >= emailWidth) return { content, changed: false };
  let changed = false;
  const visit = (block) => {
    if (block?.type === "image" && block.src === url && block.width === "full") {
      changed = true;
      return { ...block, width };
    }
    if (Array.isArray(block?.children)) {
      return { ...block, children: block.children.map((column) => column.map(visit)) };
    }
    return block;
  };
  const blocks = (content?.blocks || []).map(visit);
  return changed ? { content: { ...content, blocks }, changed } : { content, changed };
}
