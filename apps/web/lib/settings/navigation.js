// Single source for settings navigation, canonical paths and legacy ?tab= links.
export const SETTINGS_NAV = [
  {
    label: "WORKSPACE",
    items: [
      { key: "general", label: "General" },
      { key: "members", label: "Members" },
      { key: "mailboxes", label: "Channels & mailboxes" },
      { key: "tags", label: "Tags" },
    ],
  },
  {
    label: "AI & AUTOMATION",
    items: [
      { key: "ai", label: "AI instructions" },
      { key: "automation", label: "Actions & automation" },
    ],
  },
  {
    label: "COMMUNICATION",
    items: [
      { key: "email", label: "Email" },
      { key: "customer-satisfaction", label: "Customer satisfaction" },
    ],
  },
  {
    label: "ACCOUNT",
    items: [
      { key: "profile", label: "Profile & appearance" },
      { key: "billing", label: "Billing" },
    ],
  },
];

export const EMAIL_SECTIONS = [
  { key: "auto-reply", label: "Customer confirmation" },
  { key: "routing", label: "Routing" },
  { key: "sender-rules", label: "Sender rules" },
  { key: "blocklist", label: "Blocklist" },
  { key: "signatures", label: "Signatures" },
];

export const DEFAULT_SETTINGS_SECTION = "general";
export const DEFAULT_EMAIL_SECTION = "auto-reply";

const SECTION_KEYS = new Set(SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.key)));
const EMAIL_KEYS = new Set(EMAIL_SECTIONS.map((section) => section.key));

export function parseSettingsSlug(slug) {
  const parts = (Array.isArray(slug) ? slug : []).map((part) => String(part || "").trim().toLowerCase());
  const [section, sub, ...rest] = parts;
  if (!section || rest.length || !SECTION_KEYS.has(section)) return null;
  if (section === "email") {
    if (!sub) return { section, emailSection: DEFAULT_EMAIL_SECTION };
    return EMAIL_KEYS.has(sub) ? { section, emailSection: sub } : null;
  }
  return sub ? null : { section, emailSection: null };
}

export function parseSettingsPathname(pathname) {
  const path = String(pathname || "").split("?")[0].replace(/\/+$/, "");
  const match = /^\/settings\/(.+)$/.exec(path);
  return match ? parseSettingsSlug(match[1].split("/")) : null;
}

export function settingsPath(section, emailSection = null) {
  if (section === "email") {
    return `/settings/email/${EMAIL_KEYS.has(emailSection) ? emailSection : DEFAULT_EMAIL_SECTION}`;
  }
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
  const section = SECTION_KEYS.has(tab) ? tab : DEFAULT_SETTINGS_SECTION;
  return withSearchParams(settingsPath(section, read("section")), searchParams, ["tab", "section"]);
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
