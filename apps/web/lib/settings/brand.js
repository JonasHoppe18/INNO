// Workspace brand: one logo and accent color shared by the email designs.
export const BRAND_IMAGE_BUCKET = "workspace-email-signature-assets";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeAccentColor(value) {
  const color = String(value ?? "").trim();
  if (!color) return null;
  if (!HEX_COLOR.test(color)) throw new Error("Accent color must be a hex color like #4f46e5.");
  return color.toLowerCase();
}

// Only logos uploaded to this workspace's own brand folder may be saved as the brand.
export function isWorkspaceBrandLogoUrl(url, { supabaseUrl, workspaceId } = {}) {
  const value = String(url || "").trim();
  const base = String(supabaseUrl || "").trim().replace(/\/+$/, "");
  const workspace = String(workspaceId || "").trim();
  if (!value || !base || !workspace || value.includes("..")) return false;
  const prefix = `${base}/storage/v1/object/public/${BRAND_IMAGE_BUCKET}/${encodeURIComponent(workspace)}/brand/`;
  if (!prefix.startsWith("https://") || !value.startsWith(prefix)) return false;
  const fileName = value.slice(prefix.length);
  return Boolean(fileName) && !fileName.includes("/");
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
