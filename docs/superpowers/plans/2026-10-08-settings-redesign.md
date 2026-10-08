# Settings-redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg alle settings-sektioner om med de fælles byggeklodser, så hele siden har General-prototypens udtryk.

**Architecture:** `components/settings/ui/settings-layout.jsx` udvides med tabel-, fane-, tom-tilstands- og rækkemenu-byggeklodser. Hver sektion bygger kun sit indhold af dem; state, handlers og API-kald flyttes ikke. Én task pr. sektion, så hver kan screenshot-sammenlignes og committes for sig.

**Tech Stack:** Next.js 14.2.5, React 18.2, Tailwind, shadcn/Radix (`DropdownMenu`, `Select`, `Switch`, `Textarea`), lucide-react, vitest (kun rene moduler).

**Spec:** `docs/superpowers/specs/2026-10-08-settings-redesign-design.md`

## Global Constraints

- Udtryk: `bg-conversation`-flade, centreret kolonne (`form` 720 px / `wide` 960 px), ingen kort, linjer kun mellem rækker (`divide-border/60`), kontroller h-8 i en 256 px kolonne mod højre, felttekst `text-foreground`.
- Ingen sektion må style egne overflader, sidetitler, gruppetitler eller rækker. Kun byggeklodserne.
- Ingen ikoner i indholdet (ikon-cirkler, eyebrows og badges som dekoration fjernes). Status-badges med betydning (fx "Invited", "Published", "Inactive") beholdes som `Badge`-varianter.
- Formularer gemmer kun via `SettingsSaveBar`. Lister gemmer pr. handling som i dag. Email-listerne (routing, sender rules, blocklist) beholder den fælles email-gem-bar.
- Ingen ændring af state, handlers, API-kald, tekster (ud over dubletter) eller funktionalitet. Alle eksisterende felter og handlinger skal stadig findes.
- UI-tekst engelsk. `StickySaveBar` må ikke importeres i `components/settings/**` efter Task 10.
- Tests: `cd apps/web && npx vitest run lib/settings` grøn efter hver task; `npx next lint --dir components/settings` ren.
- Lokal kørsel: dev-server på port 3107 med `.env.local` + `.env.development.local` (findes i worktree). Screenshots via Claude in Chrome, ikke uploadet.
- Commits: én pr. task, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rollebaserede handlinger i Members.** En almindelig medlem må ikke se aktive "Make admin"/"Remove user"; ejer kan ikke fjernes; man kan ikke ændre sin egen rolle. Pinnes i Task 2 med en ren `memberRowPermissions`-funktion og tests.
2. **Email-kladden på tværs af faner.** En ugemt ændring i Routing skal stadig være der efter skift til Blocklist, og gem-baren gemmer begge. Pinnes i Task 7's manuelle tjek.
3. **AI-prompt uden modal.** Dirty-state, discard og navigations-guard skal virke for prompten nu, hvor den er en kladde. Pinnes i Task 5's manuelle tjek (rediger → skift sektion → confirm).
4. **`/tags`-siden** bruger samme `TagsSettings`. Den skal stadig se ordentlig ud uden settings-menuen. Pinnes i Task 3's screenshot af `/tags`.
5. **Smal skærm.** Tabeller scroller vandret i egen beholder, rækker stables. Pinnes i Task 10's tjek (DevTools device mode, hvis vinduet ikke kan resizes).

---

### Task 1: Nye byggeklodser

**Files:**
- Modify: `apps/web/components/settings/ui/settings-layout.jsx`
- Modify: `apps/web/components/settings/TabSkeleton.jsx`

**Interfaces — Produces:**
- `SettingsRow({ label, description, htmlFor, stacked?: boolean, children, controlClassName })`: `stacked` lægger kontrollen i fuld bredde under label (til tekstfelter som AI-prompt og beskeder).
- `SettingsTable({ columns: { key, label, align?: "right" }[], template: string, minWidth?: number, children })`: kolonneoverskrifter + rækker; `template` er en CSS `grid-template-columns`.
- `SettingsTableRow({ children, muted?: boolean })`: én række; arver `template` via context.
- `SettingsRowMenu({ label = "More actions", disabled, title, children })`: `⋯`-knap + `DropdownMenuContent align="end"`; children er `DropdownMenuItem`s.
- `SettingsEmptyState({ title, description, action })`.
- `SettingsTabs({ tabs: { key, label }[], value, onChange })`.

- [ ] **Step 1:** Tilføj `stacked` til `SettingsRow`:
```jsx
export function SettingsRow({ label, description, htmlFor, stacked = false, children, controlClassName }) {
  return (
    <div className={cn("flex flex-col gap-2.5 py-3.5", !stacked && "sm:flex-row sm:items-center sm:justify-between sm:gap-8")}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">{label}</label>
        {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className={cn("flex items-center", stacked ? "w-full" : "shrink-0 sm:w-64 sm:justify-end", controlClassName)}>{children}</div>
    </div>
  );
}
```
- [ ] **Step 2:** Tilføj tabel, rækkemenu, tom-tilstand og faner:
```jsx
const TableTemplateContext = createContext("1fr");

export function SettingsTable({ columns, template, minWidth = 640, children }) {
  return (
    <TableTemplateContext.Provider value={template}>
      <div className="overflow-x-auto">
        <div role="table" style={{ minWidth }}>
          <div role="row" className="grid items-center gap-4 border-b border-border/60 pb-2 text-xs text-muted-foreground" style={{ gridTemplateColumns: template }}>
            {columns.map((column) => (
              <div key={column.key} role="columnheader" className={cn(column.align === "right" && "text-right")}>{column.label}</div>
            ))}
          </div>
          <div className="divide-y divide-border/60">{children}</div>
        </div>
      </div>
    </TableTemplateContext.Provider>
  );
}

export function SettingsTableRow({ muted = false, children }) {
  const template = useContext(TableTemplateContext);
  return (
    <div role="row" className={cn("grid items-center gap-4 py-3 text-sm", muted && "text-muted-foreground")} style={{ gridTemplateColumns: template }}>
      {children}
    </div>
  );
}

export function SettingsRowMenu({ label = "More actions", disabled = false, title, children }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground" disabled={disabled} title={title} aria-label={label}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsEmptyState({ title, description, action = null }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function SettingsTabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="-mt-2 flex gap-5 border-b border-border/60">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-sm transition-colors duration-150",
              active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```
Imports: `createContext, useContext` fra react; `MoreHorizontal` fra lucide-react; `DropdownMenu, DropdownMenuContent, DropdownMenuTrigger` fra `@/components/ui/dropdown-menu`.
- [ ] **Step 3:** `TabSkeleton` i skabelonens udtryk: centreret 720 px, sidehoved (to skeleton-linjer + bundlinje), tre grupper med titel-skeleton og tre rækker (label/beskrivelse venstre, 256 px-blok højre), adskilt af `divide-border/60`. Behold `aria-busy`, `aria-label="Loading settings"` og `sr-only`-teksten.
- [ ] **Step 4:** Lint + `npx vitest run lib/settings`. General ser uændret ud (screenshot). Skeleton tjekkes ved hård reload.
- [ ] **Step 5:** Commit `"Add settings table, tabs, empty state and row menu building blocks"`.

---

### Task 2: Members

**Files:**
- Create: `apps/web/lib/settings/members.js`, `apps/web/lib/settings/__tests__/members.test.js`
- Modify: `apps/web/components/settings/sections/MembersSection.jsx`

**Interfaces — Produces:** `memberRowPermissions(member, { canManageRoles, currentClerkUserId, currentIsOwner }) → { isInvited, isOwner, isSelf, rawRole, canEditRole, canEditSignature, canRemoveMember, memberUserId }`. Logikken er den eksisterende, flyttet fra render-loopet.

- [ ] **Step 1: Fejlende test** (`members.test.js`):
```js
import { describe, expect, it } from "vitest";
import { memberRowPermissions } from "../members";

const ctx = { canManageRoles: true, currentClerkUserId: "me", currentIsOwner: false };

describe("memberRowPermissions", () => {
  it("lets an admin manage a plain member", () => {
    expect(memberRowPermissions({ org_user_id: "u1", user_id: "s1", workspace_role: "org:member" }, ctx))
      .toMatchObject({ canEditRole: true, canRemoveMember: true, canEditSignature: true, isSelf: false });
  });
  it("never allows editing the owner or yourself", () => {
    expect(memberRowPermissions({ org_user_id: "u2", workspace_role: "org:owner" }, ctx).canEditRole).toBe(false);
    expect(memberRowPermissions({ org_user_id: "me", user_id: "s3", workspace_role: "org:member" }, ctx))
      .toMatchObject({ canEditRole: false, isSelf: true, canEditSignature: true });
  });
  it("only owners can change other admins", () => {
    const admin = { org_user_id: "u4", workspace_role: "org:admin" };
    expect(memberRowPermissions(admin, ctx).canEditRole).toBe(false);
    expect(memberRowPermissions(admin, { ...ctx, currentIsOwner: true }).canEditRole).toBe(true);
  });
  it("gives non-managers no role actions and only their own signature", () => {
    const viewer = { ...ctx, canManageRoles: false };
    expect(memberRowPermissions({ org_user_id: "u5", user_id: "s5", workspace_role: "org:member" }, viewer))
      .toMatchObject({ canEditRole: false, canRemoveMember: false, canEditSignature: false });
  });
  it("flags invitations and unsynced profiles", () => {
    expect(memberRowPermissions({ email: "x@y.dk", status: "invited" }, ctx)).toMatchObject({ isInvited: true, canEditSignature: false });
  });
});
```
- [ ] **Step 2:** Kør → FAIL (modul mangler).
- [ ] **Step 3:** Implementér `members.js` ved at flytte blokken fra render-loopet (`role…isInvited`) verbatim ind i funktionen og returnere felterne. Brug den i loopet.
- [ ] **Step 4:** Kør → PASS.
- [ ] **Step 5: Markup.** `return` bliver:
```jsx
<SettingsPage
  width="wide"
  title="Members"
  description="Manage who has access to your workspace."
  actions={<Button size="sm" onClick={() => setInviteOpen(true)} disabled={!canManageRoles}>Invite member</Button>}
>
  <SettingsGroup footer={`${rows.length} ${rows.length === 1 ? "member" : "members"}`}>
    {rows.length ? (
      <SettingsTable
        template="minmax(240px,1fr) 120px 140px 40px"
        columns={[{ key: "member", label: "Member" }, { key: "role", label: "Role" }, { key: "signature", label: "Signature" }, { key: "actions", label: "" }]}
      >
        {rows.map((member) => /* SettingsTableRow: avatar (h-7 w-7) + navn/email (+ Badge "Invited" variant neutral), rolle som tekst, signatur som ghost-knap "Edit" (eller "Resend" for invitationer), SettingsRowMenu med de eksisterende DropdownMenuItems */)}
      </SettingsTable>
    ) : (
      <SettingsEmptyState title="No members yet" description="Invite your team to start working in Sona." />
    )}
  </SettingsGroup>
</SettingsPage>
```
Behold `EditSignatureModal` og invitations-`Dialog` uændret efter `SettingsPage`. Fjern eyebrow "TEAM", ikonet i invite-knappen og "Showing X of Y" (erstattet af footer).
- [ ] **Step 6:** Lint, tests. Manuelt: screenshot; "Invite member" åbner dialogen (luk uden at sende); `⋯`-menu viser samme punkter som før for din rolle; "Edit" åbner signatur-modal (luk uden at gemme).
- [ ] **Step 7:** Commit `"Rebuild Members with the settings table"`.

---

### Task 3: Tags

**Files:** Modify `apps/web/components/settings/TagsSettings.jsx`, `apps/web/app/(dashboard)/tags/page.jsx`

- [ ] **Step 1:** `return` bliver `SettingsPage width="wide" title="Tags" description=(eksisterende tekst) actions={<Button size="sm" …>New tag</Button>}`. Loading → tre skeleton-rækker. Ingen tags → `SettingsEmptyState title="No tags yet" description="Create your first tag to get started."`. Hver tag-gruppe (`groupKey`) → `SettingsGroup title={groupKey || undefined}` med `SettingsTable template="minmax(220px,1fr) minmax(0,1.4fr) 40px" columns={[Name, AI rule, ""]}`; række: farveprik + navn (+ `Badge` "Inactive" variant neutral i stedet for gennemstreget), AI-prompt afkortet muted, `SettingsRowMenu` med "Edit", "Activate/Deactivate", "Delete" (destructive-farve) som `DropdownMenuItem`s der kalder de eksisterende handlers.
- [ ] **Step 2:** `/tags/page.jsx`: fjern det indre `<div className="p-6 max-w-3xl mx-auto">` (SettingsPage styrer bredden). Lad `DashboardPageShell` blive.
- [ ] **Step 3:** Lint. Manuelt: screenshot af `/settings/tags` og `/tags`; opret en test-tag "zz-redesign-test", rediger, deaktiver, aktiver, slet den igen.
- [ ] **Step 4:** Commit `"Rebuild Tags with the settings table"`.

---

### Task 4: Channels & mailboxes

**Files:** Modify `apps/web/components/settings/MailboxesSettingsTab.jsx`

- [ ] **Step 1:** `SettingsPage width="wide" title="Channels & mailboxes" description=(eksisterende header-tekst) actions={MailboxesAddMenu når listen er tom, ellers den eksisterende add-handling hvis den findes}`. Indhold: `SettingsGroup title="Email" description="Your support inbox, forwarding address and sender identity."` med de eksisterende `MailboxRow`s som børn (de har egne linjer → fjern `divide-y`-wrapperen, gruppens divide overtager). Loading → skeleton-rækker. Fejl → `SettingsEmptyState title="Couldn't load the email channel." description={error} action={<Button size="sm" variant="outline" onClick={loadMailboxes}>Try again</Button>}`. Ingen mailboxe → `SettingsEmptyState title="Connect your support email" description=(eksisterende) action={MailboxesAddMenu}`.
- [ ] **Step 2:** Læs `MailboxRow` (find fil med `grep -rl "export function MailboxRow"`). Hvis den har egen horisontal padding (`px-6`), fjern kun den ydre padding, så rækken flugter med kolonnen. Ingen andre ændringer i `MailboxRow`.
- [ ] **Step 3:** Lint, screenshot. Ingen skrivende handlinger testes her (mailbox-opsætning rører rigtig mail-routing).
- [ ] **Step 4:** Commit `"Rebuild Channels & mailboxes with settings building blocks"`.

---

### Task 5: AI instructions uden modal

**Files:** Modify `apps/web/components/settings/sections/AiInstructionsSection.jsx`

- [ ] **Step 1:** Erstat `AiInstructionsTab`/`AiPromptModal` med en formular:
```jsx
export function AiInstructionsSection() {
  const { resources, setResource } = useSettingsWorkspace();
  const [saved, setSaved] = useState(() => String(resourcePayload(resources, "/api/persona")?.persona?.instructions || "").trim());
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const dirty = draft.trim() !== saved;
  useSettingsDirty(dirty);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ instructions: draft }),
      });
      if (!response.ok) throw new Error("Could not save AI instructions.");
      const next = draft.trim();
      setSaved(next);
      setDraft(next);
      setResource("/api/persona", { persona: { instructions: next } });
      toast.success("AI instructions saved.");
    } catch (error) {
      toast.error(error?.message || "Could not save AI instructions.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage title="AI instructions" description=(eksisterende beskrivelse fra AiInstructionsTab)>
      <SettingsGroup>
        <SettingsRow stacked label="Instructions" description=(eksisterende hjælpetekst fra modalen) htmlFor="settings-ai-prompt">
          <Textarea id="settings-ai-prompt" value={draft} onChange={(e) => setDraft(e.target.value)} rows={14} className="min-h-[280px] text-input text-foreground md:text-sm" placeholder=(eksisterende placeholder) />
        </SettingsRow>
      </SettingsGroup>
      <SettingsSaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(saved)} />
    </SettingsPage>
  );
}
```
Tekster (beskrivelse, hjælpetekst, placeholder, evt. eksempler) hentes fra den nuværende `AiInstructionsTab`/`AiPromptModal`; intet indhold forsvinder. Fjern `Dialog`-imports.
- [ ] **Step 2:** Lint. Manuelt: rediger prompten → gem-bar → skift til Members → confirm vises (annullér) → Discard → gem-bar forsvinder. Gem én gang med en ændring og gem originalen tilbage.
- [ ] **Step 3:** Commit `"Edit AI instructions inline instead of in a modal"`.

---

### Task 6: Actions & automation

**Files:** Modify `apps/web/components/settings/sections/SimpleSections.jsx`

- [ ] **Step 1:** Læs `AutomationPageHeader`. `AutomationSection` bliver `SettingsPage width="wide" title=(header-titel) description=(header-beskrivelse)` om `<AutomationPanel>` uden `AutomationPageHeader`. Hvis headeren indeholder handlinger, sendes de som `actions`. Panelets indhold er uændret.
- [ ] **Step 2:** Lint, screenshot.
- [ ] **Step 3:** Commit `"Give Actions & automation the settings page header"`.

---

### Task 7: Email

**Files:** Modify `apps/web/components/settings/sections/email/EmailSettings.jsx` (view). `EmailSection.jsx` (state) ændres ikke, bortset fra props hvis viewet skal bruge nye.

- [ ] **Step 1:** Læs hele `EmailSettings.jsx`. Lav en liste over hvert felt, hver knap og hver handling pr. undersektion i ledgeren, før markup ændres (bruges i step 7 til at tjekke at intet mangler).
- [ ] **Step 2:** Rammen: `SettingsPage title="Email" description=(eksisterende)`, derefter `SettingsTabs tabs={EMAIL_SECTIONS} value={activeSection} onChange={onSectionChange}`. Undersektionerne renderes stadig alle (skjult med `hidden`, som i dag) eller kun den aktive. Behold den nuværende "alle renderes, kun aktiv vises"-adfærd, fordi kladde-felter med intern state ellers nulstilles ved faneskift.
- [ ] **Step 3: Customer confirmation:** `SettingsGroup title="Customer confirmation"`: rækker for "Send confirmation email" (switch), "Configuration scope" (select), "Include ticket reference" (switch), "Subject" (input). Beskeden som `SettingsRow stacked`. "Edit email layout"/builder-link og "Send test" som `Button size="sm" variant="outline"` i gruppens `action` eller i en sidste række. "Save message"-knappen fjernes; ændringer gemmes via den fælles gem-bar (den findes allerede i viewet, og `hasAutoReplyChanges` indgår i `canSaveEmailSettings`).
- [ ] **Step 4: Routing / Sender rules / Blocklist:** hver som `SettingsGroup` med eksisterende titel/beskrivelse og `SettingsTable` over rækkerne; inline-redigering (selects/inputs i rækker) beholdes i cellerne med h-8; "tilføj"-formularen som sidste række i tabellen eller som gruppe-`action` + række. Slet → `SettingsRowMenu` med "Delete". Tomme lister → `SettingsEmptyState`.
- [ ] **Step 5: Signatures:** `SettingsGroup title="Outbound signature"`: "Active" (switch), builder-felter som rækker, synlighed/rækkefølge-kontroller i cellerne, logo-upload som række, preview som `SettingsRow stacked`, "Send test" som knap.
- [ ] **Step 6:** Erstat `StickySaveBar` med `SettingsSaveBar visible={canSave} saving={saving} onSave={onSaveChanges} onDiscard={onDiscardChanges}`.
- [ ] **Step 7:** Lint + names-check. Manuelt pr. fane: screenshot; tjek listen fra step 1, så hvert felt/knap findes; Review Focus 2 (ugemt routing-ændring overlever skift til Blocklist; discard nulstiller begge). Gem én ændring i confirmation-emnet og gem originalen tilbage. Opret og slet én blocklist-regel "zz-redesign-test.example".
- [ ] **Step 8:** Commit `"Rebuild Email settings with tabs, tables and the shared save bar"`.

---

### Task 8: Customer satisfaction

**Files:** Modify `apps/web/components/settings/CustomerSatisfactionSettings.jsx`

- [ ] **Step 1:** `SettingsPage title="Customer satisfaction" description=(eksisterende) actions={<Button asChild size="sm" variant="outline"><Link href="/settings/csat/email">Open email builder</Link></Button>}`. Grupper:
  - "Survey" → række "Send CSAT surveys" (switch) + eksisterende statuslinje som beskrivelse.
  - "Delivery" → række "Send survey" (select) + øvrige leveringsfelter som rækker; "Reset delivery settings" som ghost-knap i gruppens `footer`.
  - "Email" → række "CSAT survey email" med subject som beskrivelse, status-`Badge` + "Edit email"-knap i kontrolkolonnen.
  - "Responses" → række "Thank-you responses" med "Edit responses"-knap.
  - Fejl → én linje `role="alert"` i `text-danger-foreground` over grupperne.
  - Fjern `Card`, `SectionHeading`, eyebrows, ikonbokse og "CSAT"-badget i headeren.
- [ ] **Step 2:** `StickySaveBar` → `SettingsSaveBar visible={!saved} saving={saving} onSave={save} onDiscard={discard}`. Loading → `TabSkeleton`.
- [ ] **Step 3:** Lint, screenshot; skift forsinkelse → gem-bar → Discard.
- [ ] **Step 4:** Commit `"Rebuild Customer satisfaction with settings building blocks"`.

---

### Task 9: Profile & appearance og Billing

**Files:** Modify `apps/web/components/settings/sections/ProfileSection.jsx`, `apps/web/components/settings/sections/BillingSection.jsx`

- [ ] **Step 1:** Profile: `SettingsPage title="Profile & appearance" description=(eksisterende)`. Gruppe "Profile": rækker for navn-felterne, email (read-only tekst), avatar. Gruppe "Appearance": tema-valget som eksisterende `THEME_OPTIONS`-knapper i kompakt form i kontrolkolonnen (eller `stacked` hvis de ikke passer i 256 px). `StickySaveBar` → `SettingsSaveBar`.
- [ ] **Step 2:** Billing: `SettingsPage title="Billing" description=(eksisterende)` + `SettingsGroup title="Plan"` med rækker for det eksisterende indhold (plan, status) som read-only tekst/badge.
- [ ] **Step 3:** Lint, screenshots. Profile: skift tema → gem-bar → Discard (temaet må ikke blive stående).
- [ ] **Step 4:** Commit `"Rebuild Profile and Billing with settings building blocks"`.

---

### Task 10: Oprydning og slutverifikation

- [ ] **Step 1:** `grep -rn "StickySaveBar\|rounded-2xl\|shadow-sm\|uppercase tracking" apps/web/components/settings` → kun menuens gruppe-labels (SettingsShell) må stå tilbage. Fjern ubrugte imports (names-check).
- [ ] **Step 2:** Alle ti sektioner + fem email-faner: screenshot i rækkefølge, kig efter afvigelser fra skabelonen (overskrifter, rækkehøjder, kontrolbredder).
- [ ] **Step 3:** Sektionsskift-måling (samme script som split-PR'en): ingen skeleton, ingen ekstra API-kald ud over sektionernes egne eksisterende (Profile/theme, Tags, Mailboxes, CSAT).
- [ ] **Step 4:** Smal bredde via DevTools device mode (390 px) for General, Members, Email/Routing: rækker stables, tabeller scroller i egen beholder, gem-bar passer.
- [ ] **Step 5:** `npx vitest run lib/settings`, `npm run build`.
- [ ] **Step 6:** Push, PR mod `main` (unslop på titel/body, før/efter beskrevet, intet uploadet). Ingen merge.
