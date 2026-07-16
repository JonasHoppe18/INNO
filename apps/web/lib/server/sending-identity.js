const DEFAULT_SHARED_LOCAL_PART = "support";
const DEFAULT_SHARED_DOMAIN = "sona-ai.dk";
const DEFAULT_SHARED_FROM_EMAIL = `${DEFAULT_SHARED_LOCAL_PART}@${DEFAULT_SHARED_DOMAIN}`;
const DEFAULT_MANAGED_LOCAL_PART = "support";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDanishCharacters(value) {
  return String(value || "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/Æ/g, "ae")
    .replace(/Ø/g, "oe")
    .replace(/Å/g, "aa");
}

export function slugifyDomainLabel(value, fallback = "webshop") {
  const normalized = normalizeDanishCharacters(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

export function shopLabelSource(shop = {}, mailbox = {}) {
  const namedSource =
    asString(shop?.shop_name) ||
    asString(shop?.team_name) ||
    asString(shop?.name);
  if (namedSource) return namedSource;

  const shopDomain = asString(shop?.shop_domain);
  if (shopDomain) return shopDomain.replace(/^https?:\/\//i, "").split(".")[0];

  const providerEmail = asString(mailbox?.provider_email);
  const providerDomain = providerEmail.includes("@")
    ? providerEmail.split("@").pop()
    : "";
  if (providerDomain) return providerDomain.split(".")[0];

  return "webshop";
}

export function buildSharedSonaFromEmail({ shop = {}, mailbox = {} } = {}) {
  const configuredFromEmail = asString(process.env.POSTMARK_FROM_EMAIL).toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredFromEmail)) {
    return configuredFromEmail;
  }

  const localPart = slugifyDomainLabel(
    process.env.SONA_SHARED_FROM_LOCAL_PART || DEFAULT_SHARED_LOCAL_PART,
    DEFAULT_SHARED_LOCAL_PART
  );
  const rootDomain = asString(process.env.SONA_SHARED_SENDING_DOMAIN) || DEFAULT_SHARED_DOMAIN;
  const normalizedRootDomain = rootDomain.toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!normalizedRootDomain) return DEFAULT_SHARED_FROM_EMAIL;

  // Postmark verifies the shared root domain. Per-shop subdomains are separate
  // sender identities and are rejected unless each subdomain is configured in
  // Postmark, so workspace branding belongs in the display name/Reply-To.
  void shop;
  void mailbox;
  return `${localPart}@${normalizedRootDomain}`;
}

export function getManagedSenderFromMailbox(mailbox = {}) {
  const metadata =
    mailbox?.metadata && typeof mailbox.metadata === "object" ? mailbox.metadata : {};
  const managed =
    metadata?.managed_sender && typeof metadata.managed_sender === "object"
      ? metadata.managed_sender
      : null;
  if (!managed) return null;
  return {
    ...managed,
    domain: asString(managed.domain).toLowerCase() || null,
    from_email: asString(managed.from_email).toLowerCase() || null,
    status: asString(managed.status).toLowerCase() || "unprovisioned",
  };
}

export function buildManagedSenderEmail(domain) {
  const normalizedDomain = asString(domain).toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!normalizedDomain) return null;
  const localPart = slugifyDomainLabel(
    process.env.SONA_MANAGED_FROM_LOCAL_PART || DEFAULT_MANAGED_LOCAL_PART,
    DEFAULT_MANAGED_LOCAL_PART
  );
  return `${localPart}@${normalizedDomain}`;
}

export function getVerifiedManagedSenderEmail(mailbox = {}) {
  const managed = getManagedSenderFromMailbox(mailbox);
  if (
    managed?.status !== "verified" ||
    !managed?.from_email ||
    !managed?.domain ||
    !managed.from_email.endsWith(`@${managed.domain}`)
  ) {
    return null;
  }
  return buildManagedSenderEmail(managed.domain);
}

export function buildEffectiveSharedFromEmail({ shop = {}, mailbox = {} } = {}) {
  return getVerifiedManagedSenderEmail(mailbox) || buildSharedSonaFromEmail({ shop, mailbox });
}
