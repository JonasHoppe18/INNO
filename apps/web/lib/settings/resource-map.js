// Settings resources keyed by their GET url, mirroring /api/settings/bootstrap.
export const SETTINGS_RESOURCE_URLS = [
  "/api/settings/members",
  "/api/settings/test-mode",
  "/api/persona",
  "/api/settings/auto-reply",
  "/api/settings/email-signature",
  "/api/settings/email-routing",
  "/api/settings/email-sender-rules",
  "/api/settings/email-blocklist",
  "/api/inboxes",
];

export const WORKSPACE_ONLY_RESOURCE_URLS = new Set(["/api/settings/test-mode", "/api/persona"]);

export function resourcesFromBootstrap(bootstrap) {
  const resources = {};
  for (const [url, entry] of Object.entries(bootstrap?.resources || {})) {
    if (!entry || typeof entry !== "object") continue;
    resources[url] = { ok: Boolean(entry.ok), status: Number(entry.status) || 0, payload: entry.payload ?? {} };
  }
  return resources;
}

export function missingResourceUrls(resources, { hasWorkspace }) {
  return SETTINGS_RESOURCE_URLS.filter((url) =>
    !resources?.[url] && (hasWorkspace || !WORKSPACE_ONLY_RESOURCE_URLS.has(url))
  );
}

export function resourcePayload(resources, url) {
  const entry = resources?.[url];
  return entry?.ok ? entry.payload ?? {} : null;
}
