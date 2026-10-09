// Workspace brand: one logo and accent color shared by the email designs.
export const BRAND_IMAGE_BUCKET = "workspace-email-signature-assets";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeAccentColor(value) {
  const color = String(value ?? "").trim();
  if (!color) return null;
  if (!HEX_COLOR.test(color)) throw new Error("Accent color must be a hex color like #4f46e5.");
  return color.toLowerCase();
}

export function brandFromPayload(payload) {
  const color = String(payload?.accent_color || "").trim().toLowerCase();
  return { logoUrl: String(payload?.logo_url || "").trim(), accentColor: color };
}

export function brandDirty(initial, current) {
  return (
    String(initial?.logoUrl || "") !== String(current?.logoUrl || "") ||
    String(initial?.accentColor || "").toLowerCase() !== String(current?.accentColor || "").toLowerCase()
  );
}
