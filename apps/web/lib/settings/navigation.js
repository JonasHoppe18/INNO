// Single source for settings navigation, canonical paths and legacy ?tab= links.
export const SETTINGS_NAV = [
  {
    label: "Workspace",
    items: [
      { key: "general", label: "General" },
      { key: "members", label: "Members" },
      { key: "brand", label: "Brand" },
    ],
  },
  {
    label: "Channels",
    items: [
      { key: "mailboxes", label: "Mailboxes" },
      { key: "inbox-rules", label: "Inbox rules" },
    ],
  },
  {
    label: "Automatic emails",
    items: [
      { key: "confirmation-email", label: "Confirmation email" },
      { key: "customer-satisfaction", label: "Satisfaction survey" },
    ],
  },
  {
    label: "AI & automation",
    items: [
      { key: "ai", label: "AI instructions" },
      { key: "automation", label: "Actions & automation" },
    ],
  },
  {
    label: "Account",
    items: [
      { key: "profile", label: "Profile & appearance" },
      { key: "billing", label: "Billing" },
    ],
  },
];

export const DEFAULT_SETTINGS_SECTION = "general";

const SECTION_KEYS = new Set(SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.key)));

// Sections that were removed or split; old links land on their replacement.
const RETIRED_PATHS = {
  email: "/settings/confirmation-email",
  "email/auto-reply": "/settings/confirmation-email",
  "email/routing": "/settings/inbox-rules",
  "email/sender-rules": "/settings/inbox-rules",
  "email/blocklist": "/settings/inbox-rules",
  "email/signatures": "/settings/members",
};

export function retiredSettingsPath(slug) {
  const key = (Array.isArray(slug) ? slug : []).map((part) => String(part || "").trim().toLowerCase()).filter(Boolean).join("/");
  return RETIRED_PATHS[key] || null;
}

export function parseSettingsSlug(slug) {
  const parts = (Array.isArray(slug) ? slug : []).map((part) => String(part || "").trim().toLowerCase());
  const [section, ...rest] = parts;
  if (!section || rest.length || !SECTION_KEYS.has(section)) return null;
  return { section };
}

export function parseSettingsPathname(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "");
  const match = /^\/settings\/(.+)$/.exec(path);
  return match ? parseSettingsSlug(match[1].split("/")) : null;
}

export function settingsPath(section) {
  return `/settings/${SECTION_KEYS.has(section) ? section : DEFAULT_SETTINGS_SECTION}`;
}

function searchEntries(searchParams) {
  if (!searchParams) return [];
  if (typeof searchParams.entries === "function" && typeof searchParams.get === "function") {
    return Array.from(searchParams.entries());
  }
  return Object.entries(searchParams).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).filter((item) => item != null).map((item) => [key, String(item)])
  );
}

export function withSearchParams(path, searchParams, omit = []) {
  const params = new URLSearchParams();
  for (const [key, value] of searchEntries(searchParams)) {
    if (!omit.includes(key)) params.append(key, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function legacySettingsPath(searchParams) {
  const entries = searchEntries(searchParams);
  const read = (key) => String(entries.find(([name]) => name === key)?.[1] || "").trim().toLowerCase();
  const tab = read("tab");
  const retired =
    retiredSettingsPath([tab, read("section")]) || (tab === "email" ? RETIRED_PATHS.email : null);
  if (retired) return withSearchParams(retired, searchParams, ["tab", "section"]);
  const section = SECTION_KEYS.has(tab) ? tab : DEFAULT_SETTINGS_SECTION;
  return withSearchParams(settingsPath(section), searchParams, ["tab", "section"]);
}

export function isSettingsSectionPath(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "");
  return path === "/settings" || parseSettingsPathname(path) !== null;
}

// Browser back/forward bypasses navigate(); ask before it drops a dirty section's draft.
export function decideSettingsPopState({ previousUrl, nextUrl, dirty, confirm, restore }) {
  const previous = parseSettingsPathname(previousUrl);
  const next = parseSettingsPathname(nextUrl);
  if (!dirty || !previous || previous.section === next?.section) return "allow";
  if (confirm("Discard your unsaved changes?")) return "discard";
  restore(previousUrl);
  return "restore";
}

// Settings sections share one page; page-level effects keyed on the pathname
// should not rerun when only the section changes.
export function settingsPageKey(pathname) {
  return isSettingsSectionPath(pathname) ? "/settings" : pathname;
}
