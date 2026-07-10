const GODADDY_API_KEY = process.env.GODADDY_API_KEY || "";
const GODADDY_API_SECRET = process.env.GODADDY_API_SECRET || "";
const GODADDY_API_BASE_URL = (
  process.env.GODADDY_API_BASE_URL || "https://api.godaddy.com"
).replace(/\/$/, "");

function requireGoDaddyConfig() {
  if (!GODADDY_API_KEY || !GODADDY_API_SECRET) {
    throw new Error("GoDaddy DNS API credentials are missing.");
  }
}

export function toGoDaddyRecordName(hostname, zoneDomain) {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  const zone = String(zoneDomain || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host || !zone) throw new Error("DNS hostname and zone are required.");
  if (host === zone) return "@";
  const suffix = `.${zone}`;
  if (!host.endsWith(suffix)) {
    throw new Error(`DNS hostname ${host} is outside the ${zone} zone.`);
  }
  return host.slice(0, -suffix.length);
}

export async function upsertGoDaddyDnsRecord({
  zoneDomain,
  type,
  name,
  value,
  ttl = 600,
}) {
  requireGoDaddyConfig();
  const normalizedType = String(type || "").trim().toUpperCase();
  if (!normalizedType || !name || !value) {
    throw new Error("DNS record type, name, and value are required.");
  }
  const response = await fetch(
    `${GODADDY_API_BASE_URL}/v1/domains/${encodeURIComponent(zoneDomain)}/records/${encodeURIComponent(normalizedType)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}`,
      },
      body: JSON.stringify([
        {
          data: String(value),
          ttl: Math.max(600, Number(ttl) || 600),
        },
      ]),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      String(payload?.message || payload?.code || `GoDaddy DNS API ${response.status}`),
    );
  }
  return true;
}
