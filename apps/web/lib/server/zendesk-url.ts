type ZendeskUrlOptions = {
  allowedCustomHosts?: string | readonly string[] | null;
};

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

function isDnsHostname(hostname: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
    .test(hostname);
}

function isBlockedHost(hostname: string): boolean {
  if (
    hostname === "localhost" || hostname.includes(":") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    return true;
  }
  return BLOCKED_HOST_SUFFIXES.some((suffix) =>
    hostname === suffix.slice(1) || hostname.endsWith(suffix)
  );
}

function allowedCustomHostSet(
  value: ZendeskUrlOptions["allowedCustomHosts"],
): Set<string> {
  const entries = Array.isArray(value) ? value : String(value || "").split(",");
  return new Set(
    entries
      .map((entry) => String(entry || "").trim().toLowerCase())
      .map((entry) => entry.replace(/^https:\/\//, "").replace(/\.$/, ""))
      .filter((entry) =>
        isDnsHostname(entry) && !isBlockedHost(entry) && !entry.includes("/")
      ),
  );
}

/**
 * Normalize a Zendesk tenant URL and reject SSRF-capable destinations.
 *
 * Standard `*.zendesk.com` hosts are accepted. A branded/custom domain must
 * be explicitly allowlisted by the server operator through
 * ZENDESK_ALLOWED_HOSTS; user input alone can never authorize a new host.
 */
export function normalizeZendeskBaseUrl(
  input: unknown,
  options: ZendeskUrlOptions = {},
): string {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Zendesk URL is required.");
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid Zendesk URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Zendesk URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Zendesk URL must not contain credentials.");
  }
  if (parsed.port) {
    throw new Error("Zendesk URL must use the default HTTPS port.");
  }
  if (
    parsed.search || parsed.hash || parsed.pathname.replace(/\/+/g, "/") !== "/"
  ) {
    throw new Error("Zendesk URL must contain only the tenant host.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!isDnsHostname(hostname) || isBlockedHost(hostname)) {
    throw new Error("Zendesk URL host is not allowed.");
  }
  const isZendeskTenant = hostname.endsWith(".zendesk.com") &&
    hostname !== "zendesk.com";
  const isAllowedCustomHost = allowedCustomHostSet(options.allowedCustomHosts)
    .has(hostname);
  if (!isZendeskTenant && !isAllowedCustomHost) {
    throw new Error(
      "Use a Zendesk *.zendesk.com tenant URL or a server-allowlisted custom host.",
    );
  }

  return `https://${hostname}`;
}
