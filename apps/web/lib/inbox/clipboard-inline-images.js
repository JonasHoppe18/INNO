const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;

const decodeHtmlAttribute = (value = "") =>
  String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const readTagAttribute = (tag = "", name = "") => {
  const safeName = String(name || "").replace(/[^a-z0-9_-]/gi, "");
  if (!safeName) return "";
  const match = String(tag || "").match(
    new RegExp(`\\s${safeName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  return decodeHtmlAttribute(match?.[2] || match?.[3] || match?.[4] || "");
};

const readDimension = (tag = "", name = "") => {
  const value = Number(readTagAttribute(tag, name));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
};

export function extractClipboardHtmlImages(html = "") {
  const tags = String(html || "").match(IMAGE_TAG_PATTERN) || [];
  return tags.map((tag, index) => ({
    index,
    src: readTagAttribute(tag, "src"),
    width: readDimension(tag, "width"),
    height: readDimension(tag, "height"),
  }));
}

export function isLikelyClipboardContentImage(image = {}) {
  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  if ((width > 0 && width <= 4) || (height > 0 && height <= 4)) return false;
  const src = String(image?.src || "").trim().toLowerCase();
  if (!src) return true;
  return !/(?:tracking[-_]?pixel|email[-_]?open|spacer\.gif)/i.test(src);
}

export function replaceClipboardHtmlImagesWithMarkers(html = "", markers = []) {
  let index = 0;
  return String(html || "").replace(IMAGE_TAG_PATTERN, () => {
    const marker = String(markers[index] || "").trim();
    index += 1;
    return marker ? `\n${marker}\n` : "\n";
  });
}

export function isZendeskImageUrl(value = "") {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    return ["zendesk.com", "zdusercontent.com", "zendeskusercontent.com"].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
