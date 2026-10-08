# Settings-split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dele `SettingsPanel.jsx` (4.711 linjer) op i selvstændige sektioner med hver sin URL, uden synlige ændringer og med øjeblikkelige sektionsskift.

**Architecture:** Én optional catch-all-rute (`/settings/[[...slug]]`) renderer `SettingsWorkspace`. Den består af tre dele: en provider, der indlæser workspace-identitet og alle settings-ressourcer én gang (via det eksisterende bootstrap-endpoint) ind i et ressource-map; en shell med menu og guard for ugemte ændringer; og den aktive sektionskomponent. Navigation sker med `window.history.pushState`, så der aldrig er en tur til serveren. Sektioner initialiserer deres kladde synkront fra ressource-mappet og kalder `refreshResource(url)` efter gem.

**Tech Stack:** Next.js 14.2.5 App Router, React 18.2, Clerk, Supabase-klient, vitest 4 (kun rene moduler, ingen jsdom).

**Spec:** `docs/superpowers/specs/2026-10-08-settings-split-design.md`

## Global Constraints

- Primært krav: et sektionsskift viser aldrig skeleton og venter aldrig på netværk. Første visning må ikke være langsommere end i dag.
- Ingen synlige ændringer: samme markup, klasser, tekster, toasts og gem/fortryd-adfærd pr. sektion. Eneste synlige forskel er URL'en.
- Kode flyttes **verbatim**. Ændr kun det, opgaven eksplicit nævner (imports, props → kontekst, initialisering, `refreshResource`).
- Bevidst ændring (godkendt): General gemmer ikke længere AI-prompten.
- Ingen API-ændringer. Ingen ændringer i CSAT- og confirmation-builderne ud over deres tilbage-links.
- Tests: `cd apps/web && npx vitest run lib/settings` for nye tests. Fuld `npm test` og `npm run build` før PR.
- Lokal kørsel: `apps/web/.env.local` kopieres fra hovedcheckoutet (`/Users/jonashoppe/Developer/INNO/apps/web/.env.local`, peger på dev). Den committes aldrig. Screenshots gemmes lokalt i scratchpad og uploades ikke.
- Commits: én pr. task, på `feat/settings-cleanup-1008`, med `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Deep link med `mailbox_id`** (`/settings?tab=email&section=auto-reply&mailbox_id=M` fra confirmation-builderens tilbage-link). Forventet: lander på `/settings/email/auto-reply?mailbox_id=M` med den mailbox valgt. Pinnes i Task 1 (`legacySettingsPath`) og Task 6 (`initialEmailState` med requested mailbox).
2. **Revisit efter gem.** Gem General → gå til Members → tilbage til General. Forventet: de gemte værdier vises uden skeleton, ikke de gamle. Pinnes af `refreshResource`-steps i Task 5/6 og den manuelle tjekliste i Task 8.
3. **Workspace uden test-mode-ressource / uden workspace** (bootstrap-fejl eller brugere uden workspace). Forventet: samme defaults som i dag. Pinnes i Task 3 (`initialGeneralState` og `initialEmailState` defaults).
4. **Ukendt eller forkert skrevet sti** (`/settings/Email/ROUTING`, `/settings/foo`, `/settings/email/foo`). Forventet: redirect til den kanoniske sti eller til General, aldrig 404 eller blank side. Pinnes i Task 1.
5. **Ugemte ændringer + skift via mobil-select.** Forventet: samme confirm som ved klik i desktop-menuen. Pinnes i den manuelle tjekliste i Task 4 og Task 8.

---

### Task 0: Baseline-evidens (ingen kode)

**Files:** ingen i repoet; output i scratchpad `…/scratchpad/settings-baseline/`.

- [ ] **Step 1:** Kopiér `.env.local`, og installér:
  ```bash
  cp /Users/jonashoppe/Developer/INNO/apps/web/.env.local /Users/jonashoppe/Developer/INNO-main/apps/web/.env.local
  cd /Users/jonashoppe/Developer/INNO-main/apps/web && npm install && PORT=3107 npm run dev
  ```
  (kør i baggrunden; bekræft med `lsof -i :3107`, at det er din proces.)
- [ ] **Step 2:** Åbn `http://localhost:3107/settings` i en ny Chrome-fane (Claude in Chrome), logget ind med dev-brugeren. Tag screenshot (desktop 1440 bred) af hver sektion: general, members, mailboxes, tags, ai, automation, email × 5 undersektioner, customer-satisfaction, profile, billing. Gentag general og email/routing i mobilbredde (390). Gem med `save_to_disk`, navngivet `before-<sektion>.png`.
- [ ] **Step 3:** Mål via `javascript_tool`: (a) tid fra navigation-start til første sektion renderet (`performance.getEntriesByType("navigation")[0]` + tidspunkt hvor `[aria-label="Loading settings"]` forsvinder); (b) tid for et sektionsskift (klik → næste frame med ny overskrift). Notér i `baseline.md`. Notér også antal requests ved første load (Network: forventet ét `/api/settings/bootstrap`).

---

### Task 1: Navigation-modul

**Files:**
- Create: `apps/web/lib/settings/navigation.js`
- Test: `apps/web/lib/settings/__tests__/navigation.test.js`

**Interfaces — Produces:**
- `SETTINGS_NAV: { label: string, items: { key: string, label: string }[] }[]`
- `EMAIL_SECTIONS: { key: string, label: string }[]`, `DEFAULT_EMAIL_SECTION = "auto-reply"`
- `parseSettingsSlug(slug: string[] | undefined) → { section: string, emailSection: string | null } | null`
- `parseSettingsPathname(pathname: string) → same | null`
- `settingsPath(section: string, emailSection?: string | null) → string`
- `withSearchParams(path: string, searchParams: URLSearchParams | Record<string, string | string[]> | null, omit?: string[]) → string`
- `legacySettingsPath(searchParams) → string`
- `isSettingsSectionPath(pathname: string) → boolean`

- [ ] **Step 1: Skriv de fejlende tests**

```js
import { describe, expect, it } from "vitest";
import {
  EMAIL_SECTIONS,
  SETTINGS_NAV,
  isSettingsSectionPath,
  legacySettingsPath,
  parseSettingsPathname,
  parseSettingsSlug,
  settingsPath,
  withSearchParams,
} from "../navigation";

describe("settings navigation", () => {
  it("keeps the current menu order and keys", () => {
    expect(SETTINGS_NAV.map((group) => group.label)).toEqual(["WORKSPACE", "AI & AUTOMATION", "COMMUNICATION", "ACCOUNT"]);
    expect(SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.key))).toEqual([
      "general", "members", "mailboxes", "tags", "ai", "automation", "email", "customer-satisfaction", "profile", "billing",
    ]);
    expect(EMAIL_SECTIONS.map((section) => section.key)).toEqual(["auto-reply", "routing", "sender-rules", "blocklist", "signatures"]);
  });

  it("parses section slugs", () => {
    expect(parseSettingsSlug(["general"])).toEqual({ section: "general", emailSection: null });
    expect(parseSettingsSlug(["email"])).toEqual({ section: "email", emailSection: "auto-reply" });
    expect(parseSettingsSlug(["email", "routing"])).toEqual({ section: "email", emailSection: "routing" });
    expect(parseSettingsSlug(["Email", "ROUTING"])).toEqual({ section: "email", emailSection: "routing" });
  });

  it("rejects unknown or overlong slugs", () => {
    expect(parseSettingsSlug([])).toBeNull();
    expect(parseSettingsSlug(undefined)).toBeNull();
    expect(parseSettingsSlug(["foo"])).toBeNull();
    expect(parseSettingsSlug(["email", "foo"])).toBeNull();
    expect(parseSettingsSlug(["general", "extra"])).toBeNull();
    expect(parseSettingsSlug(["email", "routing", "extra"])).toBeNull();
    expect(parseSettingsSlug(["csat"])).toBeNull();
  });

  it("builds canonical paths", () => {
    expect(settingsPath("members")).toBe("/settings/members");
    expect(settingsPath("email")).toBe("/settings/email/auto-reply");
    expect(settingsPath("email", "blocklist")).toBe("/settings/email/blocklist");
    expect(settingsPath("email", "nope")).toBe("/settings/email/auto-reply");
    expect(settingsPath("nope")).toBe("/settings/general");
  });

  it("parses pathnames", () => {
    expect(parseSettingsPathname("/settings/email/routing")).toEqual({ section: "email", emailSection: "routing" });
    expect(parseSettingsPathname("/settings/profile/")).toEqual({ section: "profile", emailSection: null });
    expect(parseSettingsPathname("/settings")).toBeNull();
    expect(parseSettingsPathname("/inbox")).toBeNull();
  });

  it("maps legacy query links", () => {
    expect(legacySettingsPath(new URLSearchParams(""))).toBe("/settings/general");
    expect(legacySettingsPath(new URLSearchParams("tab=customer-satisfaction"))).toBe("/settings/customer-satisfaction");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=routing"))).toBe("/settings/email/routing");
    expect(legacySettingsPath(new URLSearchParams("tab=email&section=bogus"))).toBe("/settings/email/auto-reply");
    expect(legacySettingsPath(new URLSearchParams("tab=bogus"))).toBe("/settings/general");
    expect(legacySettingsPath({ tab: "email", section: "auto-reply", mailbox_id: "m-1" })).toBe("/settings/email/auto-reply?mailbox_id=m-1");
  });

  it("appends search params without the omitted keys", () => {
    expect(withSearchParams("/settings/general", null)).toBe("/settings/general");
    expect(withSearchParams("/settings/email/auto-reply", new URLSearchParams("tab=email&mailbox_id=a b"), ["tab"])).toBe("/settings/email/auto-reply?mailbox_id=a+b");
    expect(withSearchParams("/settings/general", { x: ["1", "2"] })).toBe("/settings/general?x=1&x=2");
  });

  it("recognizes settings section paths but not the email builders", () => {
    expect(isSettingsSectionPath("/settings")).toBe(true);
    expect(isSettingsSectionPath("/settings/general")).toBe(true);
    expect(isSettingsSectionPath("/settings/email/signatures")).toBe(true);
    expect(isSettingsSectionPath("/settings/csat/email")).toBe(false);
    expect(isSettingsSectionPath("/settings/confirmation/email")).toBe(false);
    expect(isSettingsSectionPath("/inbox")).toBe(false);
  });
});
```

- [ ] **Step 2:** Kør `cd apps/web && npx vitest run lib/settings/__tests__/navigation.test.js`. Forventet: FAIL (modul findes ikke).

- [ ] **Step 3: Implementér**

```js
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
```

- [ ] **Step 4:** Kør testen igen. Forventet: PASS.
- [ ] **Step 5:** Commit: `git add apps/web/lib/settings && git commit -m "Add settings navigation and legacy link mapping"`.

---

### Task 2: Catch-all-rute og URL-styrede faner

URL'en bliver sandheden for aktiv sektion. `SettingsPanel` er stadig monolitten i denne task.

**Files:**
- Delete: `apps/web/app/(dashboard)/settings/page.jsx`
- Create: `apps/web/app/(dashboard)/settings/[[...slug]]/page.jsx`
- Modify: `apps/web/components/settings/SettingsPanel.jsx` (konstanter `MENU_SECTIONS`/`EMAIL_SECTIONS`, `activeTab`/`emailSection`-state, query-effekten, `updateSettingsUrl`, `handleSelectTab`, `handleSelectEmailSection`, link til confirmation-builder)
- Modify: `apps/web/components/dashboard-shell.jsx` (`isSettingsWorkspace`)
- Modify: `apps/web/components/site-header.jsx` (`getSiteTitle`)
- Modify: `apps/web/components/csat/CsatEmailBuilder.jsx:18`, `apps/web/components/confirmation/ConfirmationEmailBuilder.jsx:32`

**Interfaces — Consumes:** alt fra Task 1.

- [ ] **Step 1: Ny side** `app/(dashboard)/settings/[[...slug]]/page.jsx`:

```jsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import {
  legacySettingsPath,
  parseSettingsSlug,
  settingsPath,
  withSearchParams,
} from "@/lib/settings/navigation";

export default async function SettingsPage({ params, searchParams }) {
  const { userId } = await auth();
  const slug = Array.isArray(params?.slug) ? params.slug : [];
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(["/settings", ...slug].join("/"))}`);
  }
  if (!slug.length) {
    redirect(searchParams?.tab ? legacySettingsPath(searchParams) : settingsPath("general"));
  }
  const route = parseSettingsSlug(slug);
  if (!route) redirect(settingsPath("general"));
  const canonical = settingsPath(route.section, route.emailSection);
  if (`/settings/${slug.join("/")}` !== canonical) redirect(withSearchParams(canonical, searchParams));

  return <SettingsPanel />;
}
```
Slet `app/(dashboard)/settings/page.jsx`.

- [ ] **Step 2: SettingsPanel læser URL'en.**
  - Slet de lokale `MENU_SECTIONS` og `EMAIL_SECTIONS`. Importér `SETTINGS_NAV`, `EMAIL_SECTIONS`, `DEFAULT_EMAIL_SECTION`, `parseSettingsPathname`, `settingsPath`, `withSearchParams` fra `@/lib/settings/navigation`. Tilføj ikon-mappet øverst i filen:
    ```js
    const SETTINGS_NAV_ICONS = {
      general: Building2, members: Users2, mailboxes: Inbox, tags: Tag,
      ai: Bot, automation: Zap, email: Mail, "customer-satisfaction": Star,
      profile: User, billing: CreditCard,
    };
    ```
    Erstat i render `MENU_SECTIONS.map` med `SETTINGS_NAV.map` og `<item.icon …/>` med `const Icon = SETTINGS_NAV_ICONS[item.key];` … `<Icon …/>` (samme klasser).
  - Erstat `useState("general")`/`useState("auto-reply")` for `activeTab`/`emailSection` med:
    ```js
    const route = parseSettingsPathname(pathname) || { section: "general", emailSection: null };
    const activeTab = route.section;
    const emailSection = route.emailSection || DEFAULT_EMAIL_SECTION;
    ```
  - Slet `useEffect`'en, der læser `searchParams.get("tab")`/`"section"`.
  - `updateSettingsUrl` bliver:
    ```js
    const updateSettingsUrl = useCallback(
      (tab, section = null) => {
        window.history.pushState(null, "", withSearchParams(settingsPath(tab, section), searchParams, ["tab", "section"]));
      },
      [searchParams]
    );
    ```
  - I `handleSelectTab`: fjern `setActiveTab(nextTab);` (URL'en styrer). I `handleSelectEmailSection`: fjern `setEmailSection(nextSection);`, og kald `updateSettingsUrl("email", nextSection)`.
  - Linket til confirmation-builderen (`/settings/confirmation/email…`) er uændret.
- [ ] **Step 3: Eksterne links.**
  - `CsatEmailBuilder.jsx:18`: `backHref: "/settings/customer-satisfaction",`
  - `ConfirmationEmailBuilder.jsx:32`: `` backHref: `/settings/email/auto-reply${mailboxId ? `?mailbox_id=${encodeURIComponent(mailboxId)}` : ""}`, ``
  - `dashboard-shell.jsx`: `import { isSettingsSectionPath } from "@/lib/settings/navigation";` og `const isSettingsWorkspace = isSettingsSectionPath(pathname);`
  - `site-header.jsx` i `getSiteTitle` efter `TITLE_MAP`-opslaget: `if (pathname?.startsWith("/settings")) return "Settings";`
- [ ] **Step 4: Verificér.** `npx vitest run lib/settings` (PASS). Med dev-serveren: `/settings` → `/settings/general`; `/settings?tab=email&section=routing` → `/settings/email/routing`; `/settings/Email/ROUTING` → `/settings/email/routing`; `/settings/foo` → `/settings/general`; klik i menuen skifter sektion øjeblikkeligt og opdaterer URL'en uden netværkskald til siden (Network: ingen `?_rsc`-request); browser-tilbage skifter sektion; `/settings/csat/email` viser stadig builderen uden settings-menu.
- [ ] **Step 5:** Commit: `"Serve settings sections from canonical URLs"`.

---

### Task 3: Rene state-moduler

Flyt ren logik ud af `SettingsPanel`, så sektionerne kan initialisere synkront. Det kan testes uden DOM.

**Files:**
- Create: `apps/web/lib/settings/resource-map.js`, `general.js`, `email-rows.js`, `email-state.js`
- Test: `apps/web/lib/settings/__tests__/resource-map.test.js`, `general.test.js`, `email-state.test.js`
- Modify: `apps/web/components/settings/SettingsPanel.jsx` (slet de flyttede helpers, importér dem)

**Interfaces — Produces:**
- `SETTINGS_RESOURCE_URLS: string[]` (de 9 bootstrap-URL'er i bootstrap-rækkefølge), `WORKSPACE_ONLY_RESOURCE_URLS: Set<string>` (`/api/settings/test-mode`, `/api/persona`)
- `resourcesFromBootstrap(bootstrap) → Record<url, { ok: boolean, status: number, payload: object }>`
- `missingResourceUrls(resources, { hasWorkspace: boolean }) → string[]`
- `resourcePayload(resources, url) → object | null` (kun når `ok`)
- `normalizeAutoCloseMode(value, fallback = "approve")`
- `initialGeneralState(workspace, resources) → { teamName, testMode, testEmail, supportLanguage, autoCloseMode, needsAttentionStaleDays }`
- `normalizeRoutingRows`, `routingSnapshot`, `normalizeSenderRuleMatcherValue`, `normalizeSenderRuleDestinationType`, `normalizeSenderRuleDestinationValue`, `normalizeSenderRuleRows`, `senderRulesSnapshot`, `normalizeBlocklistRows`, `blocklistSnapshot` (verbatim fra SettingsPanel)
- `DEFAULT_CONFIRMATION_SUBJECT`, `DEFAULT_CONFIRMATION_BODY_TEXT`, `DEFAULT_CONFIRMATION_TEMPLATE_HTML`
- `initialEmailState(resources, requestedMailboxId) → { confirmationConfiguration, selectedConfirmationMailboxId, autoReplyInheritsWorkspace, autoReplyEnabled, autoReplyIncludeTicketNumber, autoReplySubjectTemplate, autoReplyBodyTextTemplate, autoReplyBodyHtmlTemplate, autoReplyTemplateId, autoReplyTemplateName, autoReplyTemplateHtml, signatureIsActive, signatureTemplateHtml, emailRoutingRows, emailSenderRuleRows, emailBlocklistRows, workspaceInboxesForRules }`

`workspace` (fra Task 4) har formen `{ workspaceId, shopId, shopDomain, supabaseUserId, workspaceName, supportLanguage }`.

- [ ] **Step 1: Fejlende tests.**

`resource-map.test.js`:
```js
import { describe, expect, it } from "vitest";
import { missingResourceUrls, resourcePayload, resourcesFromBootstrap, SETTINGS_RESOURCE_URLS } from "../resource-map";

describe("settings resource map", () => {
  it("keeps every bootstrap entry, including failures", () => {
    const resources = resourcesFromBootstrap({ resources: {
      "/api/persona": { ok: true, status: 200, payload: { persona: { instructions: "x" } } },
      "/api/settings/test-mode": { ok: false, status: 500, payload: { error: "no" } },
    } });
    expect(resourcePayload(resources, "/api/persona")).toEqual({ persona: { instructions: "x" } });
    expect(resources["/api/settings/test-mode"]).toEqual({ ok: false, status: 500, payload: { error: "no" } });
    expect(resourcePayload(resources, "/api/settings/test-mode")).toBeNull();
    expect(resourcePayload(resources, "/api/inboxes")).toBeNull();
  });

  it("treats a missing bootstrap as empty", () => {
    expect(resourcesFromBootstrap(null)).toEqual({});
  });

  it("lists missing urls and skips workspace-only urls without a workspace", () => {
    const resources = resourcesFromBootstrap({ resources: { "/api/inboxes": { ok: true, status: 200, payload: {} } } });
    expect(missingResourceUrls(resources, { hasWorkspace: true })).toEqual(SETTINGS_RESOURCE_URLS.filter((url) => url !== "/api/inboxes"));
    expect(missingResourceUrls(resources, { hasWorkspace: false })).not.toContain("/api/settings/test-mode");
    expect(missingResourceUrls(resources, { hasWorkspace: false })).not.toContain("/api/persona");
  });
});
```

`general.test.js`:
```js
import { describe, expect, it } from "vitest";
import { initialGeneralState, normalizeAutoCloseMode } from "../general";
import { DEFAULT_STALE_DAYS } from "@/lib/inbox/stale-days";

const workspace = { workspaceId: "w1", workspaceName: "Acme", supportLanguage: "da" };

describe("initialGeneralState", () => {
  it("uses test-mode settings when available", () => {
    const resources = { "/api/settings/test-mode": { ok: true, status: 200, payload: {
      test_mode: true, test_email: " t@x.dk ", support_language: "de", auto_close_mode: "auto", needs_attention_stale_days: 7,
    } } };
    expect(initialGeneralState(workspace, resources)).toEqual({
      teamName: "Acme", testMode: true, testEmail: "t@x.dk", supportLanguage: "de", autoCloseMode: "auto", needsAttentionStaleDays: "7",
    });
  });

  it("falls back to workspace language and defaults without test-mode settings", () => {
    expect(initialGeneralState(workspace, {})).toEqual({
      teamName: "Acme", testMode: false, testEmail: "", supportLanguage: "da", autoCloseMode: "approve", needsAttentionStaleDays: String(DEFAULT_STALE_DAYS),
    });
  });

  it("uses English and Sona Team without a workspace", () => {
    expect(initialGeneralState({ workspaceId: null, workspaceName: "" }, {})).toMatchObject({ teamName: "Sona Team", supportLanguage: "en" });
  });

  it("normalizes auto-close mode", () => {
    expect(normalizeAutoCloseMode("auto")).toBe("auto");
    expect(normalizeAutoCloseMode("x")).toBe("approve");
    expect(normalizeAutoCloseMode(undefined, "auto")).toBe("auto");
  });
});
```

`email-state.test.js`:
```js
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIRMATION_BODY_TEXT,
  DEFAULT_CONFIRMATION_SUBJECT,
  DEFAULT_CONFIRMATION_TEMPLATE_HTML,
  initialEmailState,
} from "../email-state";

const ok = (payload) => ({ ok: true, status: 200, payload });

describe("initialEmailState", () => {
  it("returns today's defaults when nothing loaded", () => {
    expect(initialEmailState({}, "")).toEqual({
      confirmationConfiguration: null, selectedConfirmationMailboxId: "", autoReplyInheritsWorkspace: false,
      autoReplyEnabled: false, autoReplyIncludeTicketNumber: true,
      autoReplySubjectTemplate: DEFAULT_CONFIRMATION_SUBJECT, autoReplyBodyTextTemplate: DEFAULT_CONFIRMATION_BODY_TEXT,
      autoReplyBodyHtmlTemplate: "", autoReplyTemplateId: null, autoReplyTemplateName: "Default template",
      autoReplyTemplateHtml: DEFAULT_CONFIRMATION_TEMPLATE_HTML,
      signatureIsActive: true, signatureTemplateHtml: "",
      emailRoutingRows: [], emailSenderRuleRows: [], emailBlocklistRows: [], workspaceInboxesForRules: [],
    });
  });

  it("selects the requested mailbox scope", () => {
    const autoReply = {
      workspace_setting: { enabled: false, subject_template: "WS" },
      mailboxes: [{ id: "m1", inherits_workspace: true, effective: { enabled: true, subject_template: "MB", include_ticket_number: false }, template: { id: "t1", name: "Mailbox tpl" } }],
    };
    const state = initialEmailState({ "/api/settings/auto-reply": ok(autoReply) }, "m1");
    expect(state).toMatchObject({
      confirmationConfiguration: autoReply, selectedConfirmationMailboxId: "m1", autoReplyInheritsWorkspace: true,
      autoReplyEnabled: true, autoReplySubjectTemplate: "MB", autoReplyIncludeTicketNumber: false,
      autoReplyTemplateId: "t1", autoReplyTemplateName: "Mailbox tpl",
    });
    expect(initialEmailState({ "/api/settings/auto-reply": ok(autoReply) }, "unknown")).toMatchObject({ selectedConfirmationMailboxId: "", autoReplySubjectTemplate: "WS" });
  });

  it("normalizes rows and inboxes", () => {
    const state = initialEmailState({
      "/api/settings/email-signature": ok({ signature: { is_active: false, template_html: "<p>x</p>" } }),
      "/api/settings/email-routing": ok({ routes: [{ id: "r1", category_key: "Billing", label: "Billing" }, { id: "r2", category_key: "support" }] }),
      "/api/settings/email-blocklist": ok({ blocks: [{ id: "b1", matcher_type: "domain", matcher_value: "@Spam.com" }] }),
      "/api/inboxes": ok({ inboxes: [{ id: "i1" }] }),
    }, "");
    expect(state.signatureIsActive).toBe(false);
    expect(state.signatureTemplateHtml).toBe("<p>x</p>");
    expect(state.emailRoutingRows.map((row) => row.category_key)).toEqual(["billing"]);
    expect(state.emailBlocklistRows[0]).toMatchObject({ matcher_type: "domain", matcher_value: "spam.com" });
    expect(state.workspaceInboxesForRules).toEqual([{ id: "i1" }]);
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/settings`. Forventet: FAIL (moduler mangler).

- [ ] **Step 3: Implementér.**

`resource-map.js`:
```js
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
```

`general.js`:
```js
import { normalizeSupportLanguage } from "@/lib/translation/languages";
import { DEFAULT_STALE_DAYS, normalizeStaleDays } from "@/lib/inbox/stale-days";
import { resourcePayload } from "@/lib/settings/resource-map";

export const normalizeAutoCloseMode = (value, fallback = "approve") =>
  value === "auto" ? "auto" : fallback === "auto" ? "auto" : "approve";

export function initialGeneralState(workspace, resources) {
  const workspaceId = workspace?.workspaceId || null;
  const teamName = String(workspace?.workspaceName || "").trim() || "Sona Team";
  const testModePayload = workspaceId ? resourcePayload(resources, "/api/settings/test-mode") : null;
  if (!testModePayload) {
    return {
      teamName,
      testMode: false,
      testEmail: "",
      supportLanguage: workspaceId ? normalizeSupportLanguage(workspace?.supportLanguage || "en") : "en",
      autoCloseMode: "approve",
      needsAttentionStaleDays: String(DEFAULT_STALE_DAYS),
    };
  }
  return {
    teamName,
    testMode: Boolean(testModePayload.test_mode),
    testEmail: String(testModePayload.test_email || "").trim(),
    supportLanguage: normalizeSupportLanguage(testModePayload.support_language || "en"),
    autoCloseMode: normalizeAutoCloseMode(testModePayload.auto_close_mode),
    needsAttentionStaleDays: String(normalizeStaleDays(testModePayload.needs_attention_stale_days)),
  };
}
```

`email-rows.js`: flyt verbatim fra `SettingsPanel.jsx` funktionerne `normalizeRoutingRows`, `routingSnapshot`, `normalizeSenderRuleMatcherValue`, `normalizeSenderRuleDestinationType`, `normalizeSenderRuleDestinationValue`, `normalizeSenderRuleRows`, `senderRulesSnapshot`, `normalizeBlocklistRows`, `blocklistSnapshot`. Tilføj `export` foran hver `const`.

`email-state.js`:
```js
import { resourcePayload } from "@/lib/settings/resource-map";
import { normalizeBlocklistRows, normalizeRoutingRows, normalizeSenderRuleRows } from "@/lib/settings/email-rows";

export const DEFAULT_CONFIRMATION_SUBJECT = "We've received your message";
export const DEFAULT_CONFIRMATION_BODY_TEXT =
  "Hi {{customer_first_name}},\n\nThanks for contacting us. We've received your message and our support team will get back to you as soon as possible. You can reply directly to this email if you would like to add more information.\n\nBest,\n{{team_name}}";
export const DEFAULT_CONFIRMATION_TEMPLATE_HTML =
  "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>";

export function initialEmailState(resources, requestedMailboxId) {
  const state = {
    confirmationConfiguration: null,
    selectedConfirmationMailboxId: "",
    autoReplyInheritsWorkspace: false,
    autoReplyEnabled: false,
    autoReplyIncludeTicketNumber: true,
    autoReplySubjectTemplate: DEFAULT_CONFIRMATION_SUBJECT,
    autoReplyBodyTextTemplate: DEFAULT_CONFIRMATION_BODY_TEXT,
    autoReplyBodyHtmlTemplate: "",
    autoReplyTemplateId: null,
    autoReplyTemplateName: "Default template",
    autoReplyTemplateHtml: DEFAULT_CONFIRMATION_TEMPLATE_HTML,
    signatureIsActive: true,
    signatureTemplateHtml: "",
    emailRoutingRows: normalizeRoutingRows([]),
    emailSenderRuleRows: normalizeSenderRuleRows([]),
    emailBlocklistRows: normalizeBlocklistRows([]),
    workspaceInboxesForRules: [],
  };

  const autoReply = resourcePayload(resources, "/api/settings/auto-reply");
  if (autoReply) {
    const requestedMailbox = (autoReply.mailboxes || []).find((mailbox) => mailbox.id === requestedMailboxId);
    const setting = requestedMailbox?.effective || autoReply.workspace_setting || autoReply.setting || {};
    const template = requestedMailbox?.template || autoReply.workspace_template || autoReply.template || {};
    Object.assign(state, {
      confirmationConfiguration: autoReply || null,
      selectedConfirmationMailboxId: requestedMailbox?.id || "",
      autoReplyInheritsWorkspace: Boolean(requestedMailbox?.inherits_workspace),
      autoReplyEnabled: Boolean(setting?.enabled),
      autoReplyIncludeTicketNumber: setting?.include_ticket_number !== false,
      autoReplySubjectTemplate: String(setting?.subject_template || DEFAULT_CONFIRMATION_SUBJECT),
      autoReplyBodyTextTemplate: String(setting?.body_text_template || DEFAULT_CONFIRMATION_BODY_TEXT),
      autoReplyBodyHtmlTemplate: String(setting?.body_html_template || ""),
      autoReplyTemplateId: template?.id || setting?.template_id || null,
      autoReplyTemplateName: String(template?.name || "Default template"),
      autoReplyTemplateHtml: String(template?.html_layout || DEFAULT_CONFIRMATION_TEMPLATE_HTML),
    });
  }

  const signature = resourcePayload(resources, "/api/settings/email-signature")?.signature;
  if (signature) {
    state.signatureIsActive = signature.is_active !== false;
    state.signatureTemplateHtml = String(signature.template_html || "");
  }
  const routes = resourcePayload(resources, "/api/settings/email-routing")?.routes;
  if (Array.isArray(routes)) state.emailRoutingRows = normalizeRoutingRows(routes);
  const rules = resourcePayload(resources, "/api/settings/email-sender-rules")?.rules;
  if (Array.isArray(rules)) state.emailSenderRuleRows = normalizeSenderRuleRows(rules);
  const blocks = resourcePayload(resources, "/api/settings/email-blocklist")?.blocks;
  if (Array.isArray(blocks)) state.emailBlocklistRows = normalizeBlocklistRows(blocks);
  const inboxes = resourcePayload(resources, "/api/inboxes")?.inboxes;
  if (Array.isArray(inboxes)) state.workspaceInboxesForRules = inboxes;
  return state;
}
```

- [ ] **Step 4:** Slet de flyttede helpers (`normalizeAutoCloseMode` + de 9 række-funktioner) fra `SettingsPanel.jsx`, og importér dem fra `@/lib/settings/general` og `@/lib/settings/email-rows`. Kør `npx vitest run lib/settings` (PASS) og `npx next lint --file components/settings/SettingsPanel.jsx` (ingen nye fejl).
- [ ] **Step 5:** Commit: `"Extract pure settings state helpers"`.

---

### Task 4: Workspace-provider, shell og SettingsWorkspace

Indlæsning flyttes ud af `SettingsPanel` og ind i en provider. Menuen flyttes ind i en shell. `SettingsPanel` bliver en ren indholdskomponent, som `SettingsWorkspace` bruger for sektioner, der ikke er flyttet endnu.

**Files:**
- Create: `apps/web/components/settings/SettingsWorkspaceProvider.jsx`
- Create: `apps/web/components/settings/SettingsShell.jsx`
- Create: `apps/web/components/settings/SettingsWorkspace.jsx`
- Create: `apps/web/components/settings/TabSkeleton.jsx` (flyt `TabSkeleton` verbatim, `export`)
- Modify: `apps/web/components/settings/SettingsPanel.jsx`
- Modify: `apps/web/app/(dashboard)/settings/[[...slug]]/page.jsx` (render `<SettingsWorkspace />`)

**Interfaces — Produces:**
- `useSettingsWorkspace() → { loading, workspace: { workspaceId, shopId, shopDomain, supabaseUserId, workspaceName, supportLanguage }, members, setMembers, currentRole, canManageMembers, resources, refreshResource(url) → Promise<void>, reloadMembers() → Promise<void>, setWorkspaceName(name) }`
- `useSettingsDirty(isDirty: boolean)`: registrerer den aktive sektions dirty-state hos shell'en.
- `useSettingsRoute() → { section, emailSection, navigate(section, emailSection?) }`. `navigate` tjekker for ugemte ændringer. Skift mellem email-undersektioner går via `navigate("email", sub)` uden tjek, når sektionen er den samme.

- [ ] **Step 1: Provider.** `SettingsWorkspaceProvider.jsx` (`"use client"`). Flyt workspace-opslaget fra `SettingsPanel.loadData` hertil. Det dækker alt fra `const fetchOptions = …` til og med beregningen af `resolvedTeamName` og `memberOwnerId`, verbatim, med disse ændringer:
  - I stedet for `setSupportLanguage(...)`/`setInitialSupportLanguage(...)` sættes en lokal `let supportLanguage`.
  - `fetchSetting` erstattes: `let resources = resourcesFromBootstrap(bootstrap);`. Efter workspace-opslaget hentes `missingResourceUrls(resources, { hasWorkspace: Boolean(workspaceId) })` parallelt med `readResponse(url, fetchOptions)` og lægges i `resources[url] = { ok, status, payload }` (payload via `response.json().catch(() => ({}))`; fejlet fetch → `{ ok: false, status: 0, payload: {} }`). Members-svaret, der allerede blev hentet før opslaget (`serverMembersResponse`), lægges i `resources["/api/settings/members"]`, så det ikke hentes igen.
  - Grenen `!workspaceId && !supabaseUserId`: workspace sættes til null-værdier, `resources = {}`, `members = []`.
  - Members: hvis `workspaceId`, så `members = resourcePayload(resources, "/api/settings/members")?.members ?? []` (fejl → `throw new Error("Could not load workspace members.")` som i dag), `currentRole`, `canManageMembers` fra samme payload. Ellers profiles-fallback (Supabase `profiles` for `memberOwnerId`) som i dag.
  - Fejl: `console.error("Settings load failed:", error); toast.error("Could not load settings.");` som i dag. `loading` false i `finally`.
  - Load-token (`settingsLoadRef`) og afhængigheder beholdes som i dag.

  Skelet:
  ```jsx
  "use client";
  import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
  import { useAuth, useUser } from "@clerk/nextjs";
  import { toast } from "sonner";
  import { useScopedReadResource } from "@/hooks/useScopedReadResource";
  import { useClerkSupabase } from "@/lib/useClerkSupabase";
  import { normalizeSupportLanguage } from "@/lib/translation/languages";
  import { missingResourceUrls, resourcePayload, resourcesFromBootstrap } from "@/lib/settings/resource-map";

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const EMPTY_WORKSPACE = { workspaceId: null, shopId: null, shopDomain: "", supabaseUserId: null, workspaceName: "Sona Team", supportLanguage: "en" };
  const SettingsWorkspaceContext = createContext(null);

  export function useSettingsWorkspace() {
    const value = useContext(SettingsWorkspaceContext);
    if (!value) throw new Error("useSettingsWorkspace must be used inside SettingsWorkspaceProvider.");
    return value;
  }

  async function readEntry(readResponse, url) {
    try {
      const response = await readResponse(url, { method: "GET", cache: "no-store", credentials: "include" });
      return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
    } catch {
      return { ok: false, status: 0, payload: {} };
    }
  }

  export function SettingsWorkspaceProvider({ children }) {
    const { ready: readsReady, readResponse } = useScopedReadResource();
    const supabase = useClerkSupabase();
    const { user } = useUser();
    const { orgId } = useAuth();
    const [loading, setLoading] = useState(true);
    const [workspace, setWorkspace] = useState(EMPTY_WORKSPACE);
    const [resources, setResources] = useState({});
    const [members, setMembers] = useState([]);
    const [currentRole, setCurrentRole] = useState("");
    const [canManageMembers, setCanManageMembers] = useState(false);
    const loadRef = useRef(0);

    const load = useCallback(async () => {
      // moved workspace resolution from SettingsPanel.loadData (see step text)
    }, [readsReady, readResponse, orgId, supabase, user?.id, user?.publicMetadata?.supabase_uuid]);

    useEffect(() => {
      load().catch(() => null);
      return () => { loadRef.current += 1; };
    }, [load]);

    const refreshResource = useCallback(async (url) => {
      const entry = await readEntry(readResponse, url);
      if (entry.ok) setResources((current) => ({ ...current, [url]: entry }));
    }, [readResponse]);

    const reloadMembers = useCallback(async () => {
      const entry = await readEntry(readResponse, "/api/settings/members");
      if (!entry.ok) return;
      setResources((current) => ({ ...current, "/api/settings/members": entry }));
      setMembers(Array.isArray(entry.payload?.members) ? entry.payload.members : []);
      setCurrentRole(String(entry.payload?.current_role || ""));
      setCanManageMembers(Boolean(entry.payload?.can_manage_members));
    }, [readResponse]);

    const setWorkspaceName = useCallback((name) => setWorkspace((current) => ({ ...current, workspaceName: name })), []);

    const value = useMemo(() => ({
      loading, workspace, resources, members, setMembers, currentRole, canManageMembers,
      refreshResource, reloadMembers, setWorkspaceName,
    }), [loading, workspace, resources, members, currentRole, canManageMembers, refreshResource, reloadMembers, setWorkspaceName]);

    return <SettingsWorkspaceContext.Provider value={value}>{children}</SettingsWorkspaceContext.Provider>;
  }
  ```
  I dag kalder `MembersTab`s `onInviteCreated`/`onMembersChanged` `loadData`, som henter alt igen. Nu kalder de `reloadMembers`. Effekten er den samme for Members-visningen, men andre sektioners kladder bliver ikke nulstillet.

- [ ] **Step 2: Shell.** `SettingsShell.jsx` (`"use client"`). Flyt `<main className="settings-theme …">`-markup'en (mobil-select, `<aside>`, indholdscontainer) verbatim fra `SettingsPanel`s return. Props: `{ activeSection, onSelectSection, children }`. Brug `SETTINGS_NAV` + `SETTINGS_NAV_ICONS` (flyt ikon-mappet og de nødvendige lucide-imports hertil). `onChange` på select og `onClick` på knapperne kalder `onSelectSection(key)`. `{renderContent()}` erstattes af `{children}`.

- [ ] **Step 3: SettingsWorkspace.** `SettingsWorkspace.jsx`:
  ```jsx
  "use client";
  import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
  import { usePathname, useSearchParams } from "next/navigation";
  import { SettingsShell } from "@/components/settings/SettingsShell";
  import { SettingsWorkspaceProvider, useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";
  import { TabSkeleton } from "@/components/settings/TabSkeleton";
  import { SettingsPanel } from "@/components/settings/SettingsPanel";
  import { DEFAULT_EMAIL_SECTION, parseSettingsPathname, settingsPath, withSearchParams } from "@/lib/settings/navigation";

  const SettingsRouteContext = createContext(null);
  export function useSettingsRoute() { return useContext(SettingsRouteContext); }
  export function useSettingsDirty(isDirty) {
    const route = useContext(SettingsRouteContext);
    useEffect(() => {
      route?.setDirty(Boolean(isDirty));
      return () => route?.setDirty(false);
    }, [route?.setDirty, isDirty]);
  }

  // Sections that have moved out of SettingsPanel. Filled in by later tasks.
  const SECTION_COMPONENTS = {};

  function SettingsContent({ section }) {
    const { loading } = useSettingsWorkspace();
    if (loading) return <TabSkeleton />;
    const Section = SECTION_COMPONENTS[section];
    return Section ? <Section /> : <SettingsPanel />;
  }

  export function SettingsWorkspace() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const route = parseSettingsPathname(pathname) || { section: "general", emailSection: null };
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;

    useEffect(() => {
      if (!dirty) return undefined;
      const handleBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ""; };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => window.removeEventListener("beforeunload", handleBeforeUnload);
    }, [dirty]);

    const navigate = useCallback((section, emailSection = null) => {
      if (section !== route.section && dirtyRef.current && !window.confirm("Discard your unsaved changes?")) return;
      if (section !== route.section) setDirty(false);
      window.history.pushState(null, "", withSearchParams(settingsPath(section, emailSection), searchParams, ["tab", "section"]));
    }, [route.section, searchParams]);

    const routeValue = useMemo(() => ({
      section: route.section,
      emailSection: route.emailSection || DEFAULT_EMAIL_SECTION,
      navigate,
      setDirty,
    }), [route.section, route.emailSection, navigate]);

    return (
      <SettingsWorkspaceProvider>
        <SettingsRouteContext.Provider value={routeValue}>
          <SettingsShell activeSection={route.section} onSelectSection={(key) => key !== route.section && navigate(key)}>
            <SettingsContent section={route.section} />
          </SettingsShell>
        </SettingsRouteContext.Provider>
      </SettingsWorkspaceProvider>
    );
  }
  ```
  `SECTION_COMPONENTS` udfyldes i Task 5–7 ved import af sektionerne.

- [ ] **Step 4: SettingsPanel som indhold.**
  - Slet `loadData`, `settingsLoadRef`, dens `useEffect`, `loading`-state, `useScopedReadResource`, `UUID_REGEX`, `TabSkeleton`, `<main>`-markup'en, `updateSettingsUrl`, `handleSelectTab`, `hasCurrentTabChanges`, beforeunload-effekten og ikon-mappet/nav-imports.
  - `const { workspace, resources, members, setMembers, currentRole, canManageMembers, reloadMembers, refreshResource } = useSettingsWorkspace();` og `const { section: activeTab, emailSection, navigate } = useSettingsRoute();`
  - `workspaceId`, `shopId`, `shopDomain` læses fra `workspace` (fjern deres `useState`). `members`/`setMembers`, `workspaceCurrentRole` → `currentRole`, `canManageWorkspaceMembers` → `canManageMembers` (fjern deres `useState`).
  - Initialisér general- og email-state synkront: `const generalInit = useMemo(() => initialGeneralState(workspace, resources), []);` og `const emailInit = useMemo(() => initialEmailState(resources, requestedConfirmationMailboxRef.current), []);` (eslint-disable-next-line for tomme deps, med kommentaren `// Drafts initialize once per mount from the loaded resources.`). Hver `useState(<default>)` for de felter, der indgår i returværdierne, bliver `useState(generalInit.x)`/`useState(emailInit.x)`, både for aktuel og `initial…`. `aiPrompt`/`initialAiPrompt` initialiseres fra `String(resourcePayload(resources, "/api/persona")?.persona?.instructions || "").trim()`.
  - `handleSelectEmailSection(next)` → `navigate("email", next)`.
  - `useSettingsDirty((activeTab === "general" && canSave) || (activeTab === "email" && canSaveEmailSettings));`
  - `MembersTab` får `onInviteCreated={reloadMembers}` og `onMembersChanged={reloadMembers}`.
  - Komponentens return bliver `renderContent()` (uden `loading`-grenen).
  - Efter gem i General: `refreshResource("/api/settings/test-mode")`. Efter gem af AI: `refreshResource("/api/persona")`. Efter `handleSaveEmailSettings` lykkes: `refreshResource` for de ændrede URL'er (auto-reply, email-signature, email-routing, email-sender-rules, email-blocklist).
- [ ] **Step 5: Siden** renderer `<SettingsWorkspace />` i stedet for `<SettingsPanel />`.
- [ ] **Step 6: Verificér.** `npx vitest run lib/settings`, `npm run lint`. Manuelt på localhost: alle sektioner ser ud som baseline-screenshots; Network ved første load viser ét `/api/settings/bootstrap` og ingen enkelt-ressource-kald; sektionsskift laver nul requests og viser ingen skeleton; redigér General → klik Members (desktop) → confirm vises; samme via mobil-select (390 bred); reload med ugemt ændring → browser-advarsel; gem General → Members → General viser gemte værdier.
- [ ] **Step 7:** Commit: `"Load settings once in a workspace provider and move navigation into a shell"`.

---

### Task 5: General og AI instructions som sektioner

**Files:**
- Create: `apps/web/components/settings/sections/GeneralSection.jsx`
- Create: `apps/web/components/settings/sections/AiInstructionsSection.jsx`
- Modify: `apps/web/components/settings/SettingsWorkspace.jsx` (`SECTION_COMPONENTS`)
- Modify: `apps/web/components/settings/SettingsPanel.jsx` (fjern de flyttede dele)

**Interfaces — Consumes:** `useSettingsWorkspace`, `useSettingsDirty`, `initialGeneralState`, `normalizeAutoCloseMode`, `resourcePayload`.

- [ ] **Step 1: GeneralSection.** Flyt `GeneralTab` og `StoreTeamRow` (hvis kun brugt af GeneralTab/MembersTab: `StoreTeamRow` placeres i `components/settings/sections/StoreTeamRow.jsx` og importeres begge steder) verbatim. Komponenten:
  ```jsx
  export function GeneralSection() {
    const supabase = useClerkSupabase();
    const { workspace, resources, refreshResource, setWorkspaceName } = useSettingsWorkspace();
    const { workspaceId, shopId, shopDomain } = workspace;
    // Drafts initialize once per mount from the loaded resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const init = useMemo(() => initialGeneralState(workspace, resources), []);
    const [saving, setSaving] = useState(false);
    const [teamName, setTeamName] = useState(init.teamName);
    const [initialTeamName, setInitialTeamName] = useState(init.teamName);
    // … testMode, testEmail, supportLanguage, autoCloseMode, needsAttentionStaleDays: same pattern
  ```
  Flyt `canSave`, `handleSaveGeneral` og `handleResetGeneral` verbatim, med disse ændringer:
  - Fjern `aiPrompt`/`initialAiPrompt` fra `canSave` og deps. Fjern blokken `// Save AI Prompt if changed` (godkendt ændring).
  - Efter vellykket gem: `refreshResource("/api/settings/test-mode"); setWorkspaceName(nextTeamName);`
  - `useSettingsDirty(canSave);`
  - Render `<GeneralTab …/>` med samme props som i dag.
- [ ] **Step 2: AiInstructionsSection.** Flyt `AiInstructionsTab` og `AiPromptModal` verbatim. Komponenten:
  ```jsx
  export function AiInstructionsSection() {
    const { resources, refreshResource } = useSettingsWorkspace();
    const [aiPrompt, setAiPrompt] = useState(() => String(resourcePayload(resources, "/api/persona")?.persona?.instructions || "").trim());
    return (
      <AiInstructionsTab
        value={aiPrompt}
        onChange={setAiPrompt}
        saving={false}
        onSave={async (newPrompt) => {
          const response = await fetch("/api/persona", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ instructions: newPrompt }),
          });
          if (!response.ok) throw new Error("Could not save AI instructions.");
          refreshResource("/api/persona");
          toast.success("AI instructions saved.");
        }}
      />
    );
  }
  ```
  `saving` var i dag Generals `saving`. `AiInstructionsTab` sender den videre til modalen, som selv håndterer sin gemme-tilstand. Tjek `AiPromptModal`. Hvis den kun bruger `saving` til at disable knappen under Generals gem, er `false` korrekt.
- [ ] **Step 3:** `SECTION_COMPONENTS = { general: GeneralSection, ai: AiInstructionsSection }`. Fjern fra `SettingsPanel`: general-state, `aiPrompt`-state, `canSave`, `handleSaveGeneral`, `handleResetGeneral`, `GeneralTab`, `AiInstructionsTab`, `AiPromptModal`, case `"ai"` og `default`/`"general"` i `renderContent`. Dirty-registreringen i `SettingsPanel` bliver `useSettingsDirty(activeTab === "email" && canSaveEmailSettings);`. Fjern `generalInit`.
- [ ] **Step 4: Verificér.** Lint. Manuelt: General og AI matcher baseline; redigér teamnavn → gem → toast "Settings saved." → Members → General viser nyt navn; fortryd-knap nulstiller; AI-modal gemmer og viser toast; confirm ved skift med ugemt General.
- [ ] **Step 5:** Commit: `"Move General and AI instructions into their own sections"`.

---

### Task 6: Email som sektion

**Files:**
- Create: `apps/web/components/settings/sections/email/EmailSection.jsx`
- Create: `apps/web/components/settings/sections/email/EmailSettings.jsx` (view, verbatim)
- Create: `apps/web/components/settings/sections/email/signature-builder.js`
- Modify: `SettingsWorkspace.jsx`, `SettingsPanel.jsx`

**Interfaces — Consumes:** `initialEmailState`, email-row-helpers, `useSettingsWorkspace`, `useSettingsRoute`, `useSettingsDirty`.

- [ ] **Step 1: Signatur-builder.** Flyt alt fra `const SIGNATURE_BUILDER_MARKER_PREFIX` til lige før `function EmailSettings(` verbatim til `signature-builder.js`. Eksportér hver top-level `const`/`function`, som `EmailSettings` bruger.
- [ ] **Step 2: View.** Flyt `function EmailSettings({...})` verbatim til `EmailSettings.jsx` som `export function EmailSettings`. Kopiér de imports, den bruger (lucide-ikoner, ui-komponenter, `cn`, `toast`, `normalizeSignatureImageUrl`/`uploadEmailSignatureImage`, `EMAIL_SECTIONS` fra navigation, signature-builder-exports). Fjern ubrugte imports med lint.
- [ ] **Step 3: EmailSection.** Flyt al email-state og alle handlers fra `SettingsPanel` verbatim: `applyConfirmationScope`, `handleConfirmationMailboxChange`, `handleSaveAutoReply`, routing/sender-rule/blocklist-handlers, `handleSendSignatureTest`, `hasAutoReplyChanges` … `canSaveEmailSettings`, `handleDiscardEmailSettings`, `handleSaveEmailSettings`. Initialisering:
  ```jsx
  export function EmailSection() {
    const { user } = useUser();
    const searchParams = useSearchParams();
    const { resources, refreshResource } = useSettingsWorkspace();
    const { emailSection, navigate } = useSettingsRoute();
    // Drafts initialize once per mount from the loaded resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const init = useMemo(() => initialEmailState(resources, searchParams?.get("mailbox_id") || ""), []);
    const [confirmationConfiguration, setConfirmationConfiguration] = useState(init.confirmationConfiguration);
    const [selectedConfirmationMailboxId, setSelectedConfirmationMailboxId] = useState(init.selectedConfirmationMailboxId);
    const [autoReplyEnabled, setAutoReplyEnabled] = useState(init.autoReplyEnabled);
    const [initialAutoReplyEnabled, setInitialAutoReplyEnabled] = useState(init.autoReplyEnabled);
    // … same pattern for every field in initialEmailState, current + initial…
  ```
  Ændringer ud over flytningen: efter vellykket `handleSaveEmailSettings` kaldes `refreshResource` for hver af `/api/settings/auto-reply`, `/api/settings/email-signature`, `/api/settings/email-routing`, `/api/settings/email-sender-rules`, `/api/settings/email-blocklist`, som blev gemt i kaldet. `useSettingsDirty(canSaveEmailSettings);`. `onSectionChange={(next) => navigate("email", next)}` og `activeSection={emailSection}`. Render `<EmailSettings …/>` med præcis de samme props som i dag.
- [ ] **Step 4:** `SECTION_COMPONENTS.email = EmailSection`. Fjern fra `SettingsPanel` alt email-relateret, `emailInit`, `requestedConfirmationMailboxRef`, case `"email"` og dirty-registreringen.
- [ ] **Step 5: Verificér.** Lint. Manuelt: alle fem undersektioner matcher baseline; skift mellem undersektioner bevarer en ugemt routing-ændring (gem-baren står stadig); gem → toast "Email settings saved." → Members → Email viser gemt værdi; discard nulstiller; `/settings/email/auto-reply?mailbox_id=<id fra dev>` vælger mailboxen; confirmation-builder → tilbage lander på samme mailbox; send signatur-test virker (eller viser samme fejl som i dag).
- [ ] **Step 6:** Commit: `"Move email settings into their own section"`.

---

### Task 7: Øvrige sektioner og sletning af SettingsPanel

**Files:**
- Create: `sections/MembersSection.jsx`, `sections/ProfileSection.jsx`, `sections/BillingSection.jsx`, `sections/SimpleSections.jsx`
- Modify: `SettingsWorkspace.jsx`
- Delete: `apps/web/components/settings/SettingsPanel.jsx`

- [ ] **Step 1:** Flyt `MembersTab` (+ dens helpers og `EditSignatureModal`-brug) verbatim til `MembersSection.jsx`. Wrapper:
  ```jsx
  export function MembersSection() {
    const { user } = useUser();
    const { orgRole } = useAuth();
    const { members, setMembers, currentRole, canManageMembers, reloadMembers } = useSettingsWorkspace();
    return (
      <MembersTab
        members={members}
        currentOrgRole={currentRole || orgRole}
        currentClerkUserId={user?.id ?? null}
        canManageRoles={
          canManageMembers ||
          String(orgRole || "").toLowerCase().includes("admin") ||
          String(orgRole || "").toLowerCase().includes("owner")
        }
        onInviteCreated={reloadMembers}
        onMembersChanged={reloadMembers}
        onSignatureSaved={(userId, signature) => {
          setMembers((prev) => prev.map((member) => (member.user_id === userId ? { ...member, signature } : member)));
        }}
      />
    );
  }
  ```
- [ ] **Step 2:** Flyt `ProfileTab` verbatim til `ProfileSection.jsx` (`export function ProfileSection() { const { user, isLoaded } = useUser(); return <ProfileTab user={user} isLoaded={isLoaded} />; }`). Hvis `ProfileTab` har egne ugemte ændringer (`handleDiscardProfile`), registrér dem ikke. I dag deltager Profile ikke i tab-guarden.
- [ ] **Step 3:** Flyt `BillingTab` til `BillingSection.jsx`. `SimpleSections.jsx`:
  ```jsx
  "use client";
  import { MailboxesSettingsTab } from "@/components/settings/MailboxesSettingsTab";
  import { TagsSettings } from "@/components/settings/TagsSettings";
  import { CustomerSatisfactionSettings } from "@/components/settings/CustomerSatisfactionSettings";
  import { AutomationPanel } from "@/components/agent/AutomationPanel";
  import { AutomationPageHeader } from "@/components/agent/AutomationPageHeader";
  import { useSettingsWorkspace } from "@/components/settings/SettingsWorkspaceProvider";

  export const MailboxesSection = () => <MailboxesSettingsTab />;
  export const TagsSection = () => <div className="w-full"><TagsSettings /></div>;
  export const AutomationSection = () => <AutomationPanel><AutomationPageHeader /></AutomationPanel>;
  export function CustomerSatisfactionSection() {
    const { workspace } = useSettingsWorkspace();
    return <CustomerSatisfactionSettings workspaceName={workspace.workspaceName} />;
  }
  ```
  (`workspaceName` var i dag Generals `teamName`-kladde. Nu er det det gemte navn, og ugemte navneændringer kan ikke nå hertil uden at krydse confirm.)
- [ ] **Step 4:** `SECTION_COMPONENTS` får alle ti nøgler. `SettingsContent` renderer `<Section />` uden fallback. Hvis nøglen ukendt (kan ikke ske efter page-redirect), renderes `GeneralSection`. Slet `SettingsPanel.jsx` og importen. `grep -rn "SettingsPanel" apps/web --include=*.js --include=*.jsx` skal være tom.
- [ ] **Step 5: Verificér.** `npm run lint`, `npx vitest run lib/settings`. Manuelt: members (invite-dialog åbner; rolleskift virker eller viser samme fejl), profile (tema-skift), billing, mailboxes, tags, automation, customer-satisfaction (link til CSAT-builder) matcher baseline.
- [ ] **Step 6:** Commit: `"Move remaining settings sections out and delete SettingsPanel"`.

---

### Task 8: Slutverifikation og PR

- [ ] **Step 1:** `cd apps/web && npm test && npm run build`. Begge grønne. Notér pre-eksisterende fejl, hvis nogen, med output.
- [ ] **Step 2:** Gentag Task 0 Step 2–3 som `after-*.png` og `after.md`. Sammenlign billederne parvis (læs dem side om side). Den eneste tilladte forskel er URL-linjen. Sammenlign tider: første load ≤ baseline, sektionsskift ≤ baseline og uden skeleton/requests.
- [ ] **Step 3:** Review Focus-tjeklisten fra toppen af planen (1–5), manuelt.
- [ ] **Step 4:** Fjern `apps/web/.env.local` fra worktree'en, eller bekræft at den er gitignored (`git check-ignore apps/web/.env.local`). Stop dev-serveren.
- [ ] **Step 5:** Push og åbn PR mod `main`. Kør `/unslop` på titel og body. Body: hvad (split, ruter, provider), hvordan testet (tests, build, før/efter-tider og en beskrivelse af screenshot-sammenligningen; billederne uploades ikke), bevidst ændring (AI-prompt via General), risici (sektioner initialiserer én gang pr. mount; members-reload rører ikke andre sektioner). Merge ikke.
