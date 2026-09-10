export const DEFAULT_INBOUND_DOMAIN = "inbound.sona-ai.dk";

export function normalizeInboundDomain(
  value,
  fallback = DEFAULT_INBOUND_DOMAIN,
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\.+$/, "");

  return normalized || fallback;
}

export function buildInboundAddress(
  slug,
  domain = process.env.NEXT_PUBLIC_INBOUND_DOMAIN,
) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) return "";

  return `${normalizedSlug}@${normalizeInboundDomain(domain)}`;
}
