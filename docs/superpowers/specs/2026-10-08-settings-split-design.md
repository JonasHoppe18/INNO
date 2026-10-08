# Settings-split — design

Dato: 2026-10-08 · Branch: `feat/settings-cleanup-1008` · Status: til review

## Formål

Settings-oprydningen kører i tre trin: **(1) split** → (2) visuelt redesign → (3) informationsarkitektur. Denne spec dækker kun trin 1.

Målet er at dele `apps/web/components/settings/SettingsPanel.jsx` (4.711 linjer) op i selvstændige sektioner med hver sin rute, data og kladde. Så kan trin 2 og 3 laves som små PR'er pr. sektion, og nye indstillinger (SLA, auto-mode) kan tilføjes som nye sektioner uden at røre resten.

**Primært krav: siden skal føles hurtig.** Et sektionsskift må ikke vise skeleton eller vente på netværk. Første visning må ikke være langsommere end i dag. Menuen vises med det samme.

**Succeskriterium i øvrigt:** ingen synlige ændringer. Hver sektion ser ud og opfører sig som før: indlæsning, redigering, gem, fortryd, advarsel om ugemte ændringer og deep links. Den eneste synlige forskel er, at URL'en bliver `/settings/<sektion>` i stedet for `/settings?tab=<sektion>`.

## Ikke i scope

- Visuelle ændringer, nye layouts, ens gem-mønster (trin 2).
- Omdøbning, omgruppering eller flytning af sektioner (trin 3).
- At flytte direkte Supabase-skrivninger fra klienten til API'et.
- Ændringer i API-ruter, ud over at bootstrap evt. bruges som cache-seed (uændret respons).
- CSAT- og confirmation-email-builderne (`/settings/csat/*`, `/settings/confirmation/*`), bortset fra deres tilbage-links.

## Ruter

Sektionerne ligger i en route group, så builderne ikke arver settings-layoutet:

```
app/(dashboard)/settings/
  page.jsx                      → redirect (se "Gamle links")
  (sections)/
    layout.jsx                  → SettingsShell: venstremenu + mobil-select + SettingsWorkspaceProvider
    general/page.jsx
    members/page.jsx
    mailboxes/page.jsx
    tags/page.jsx
    ai/page.jsx
    automation/page.jsx
    email/
      layout.jsx                → EmailSettingsProvider (delt kladde på tværs af undersektioner)
      page.jsx                  → redirect til /settings/email/auto-reply
      [section]/page.jsx        → auto-reply | routing | sender-rules | blocklist | signatures; ellers notFound()
    customer-satisfaction/page.jsx
    profile/page.jsx
    billing/page.jsx
  csat/…  confirmation/…        → uændret, uden for gruppen
```

Rute-nøglerne er de nuværende tab- og section-nøgler. Det holder redirects trivielle og lader trin 3 omdøbe ét sted.

### Gamle links

`/settings` (page.jsx, server-komponent) redirecter:

- uden params → `/settings/general`
- `?tab=email&section=X[&mailbox_id=M]` → `/settings/email/X[?mailbox_id=M]` (ukendt section → `auto-reply`)
- `?tab=<gyldig nøgle>` → `/settings/<nøgle>`, øvrige params bevares
- ukendt tab → `/settings/general`

Mappingen er en ren funktion `legacySettingsPath(searchParams)` i `lib/settings/navigation.js` med unit tests.

Interne links opdateres til de nye stier: `CsatEmailBuilder` back-link, `ConfirmationEmailBuilder` back-link og `SettingsPanel`s link til confirmation-builderen. Links til `/settings` uden params (nav-user, test-mode-banner, playground) behøver ikke ændres, fordi redirecten dækker dem.

`dashboard-shell.jsx` bruger i dag `pathname === "/settings"` til fast højde. Den skal i stedet bruge `isSettingsSectionPath(pathname)` fra samme modul, som er sand for sektionsruterne og falsk for builderne. `site-header.jsx`'s `TITLE_MAP` får et `startsWith("/settings")`-fald, så titlen stadig er "Settings". Headeren vises i dag kun i inbox, så det er kun for en sikkerheds skyld.

## Navigation

`lib/settings/navigation.js` er eneste kilde til navigationen:

- `SETTINGS_NAV`: grupperne og punkterne fra `MENU_SECTIONS` (key, label, ikon, href)
- `EMAIL_SECTIONS`: fra den nuværende fil
- `legacySettingsPath`, `isSettingsSectionPath`

`SettingsShell` renderer desktop-menuen og mobil-`<select>` præcis som i dag. Aktivt punkt udledes af `usePathname()` i stedet for `activeTab`-state. Punkterne er `Link`s. Mobil-select navigerer med `router.push`.

## Data: workspace-kontekst + sektioner der henter selv

### SettingsWorkspaceProvider (i sections-layoutet)

Ejer kun *hvem er jeg* og bruges af flere sektioner. Den indeholder den nuværende opslagslogik fra `loadData` (members-respons → workspace-id, navn, rolle, support-sprog; fallback via `profiles`/`workspaces`/`workspace_members`/`shops`), flyttet uændret.

Eksponerer: `{ loading, error, workspaceId, shopId, shopDomain, supabaseUserId, workspaceName, currentRole, canManageMembers, members, reload, setWorkspaceName }`.

Den kalder `/api/settings/bootstrap` én gang og gemmer svaret i et ressource-map i provideren (`resources[url] = { ok, status, payload }`). Kortet lever, så længe man er inde på settings-ruterne, fordi layoutet ikke unmountes ved sektionsskift. Det har ingen TTL og ingen baggrunds-genhentning, ligesom i dag hvor alt hentes én gang pr. sidevisning.

Sektionerne læser via `useSettingsResource(url)`, som returnerer data synkront fra kortet. Hvis ressourcen mangler eller fejlede i bootstrap, henter hooken den via `readResponse` og lægger den i kortet. Efter et vellykket gem opdaterer sektionen kortet med det persisterede resultat (`setResource(url, payload)`), så den næste visning er korrekt uden et nyt kald.

`scopedReadCache` (TTL 15 s) bruges ikke til settings, fordi dens udløb ville give skeleton-blink ved sektionsskift.

### Sektionerne

Hver sektion er en komponent i `components/settings/sections/` med sit eget state, sin indlæsning via `readJson`, sin kladde, dirty-beregning og gem-handler. De flyttes uændret fra den nuværende fil:

| Fil | Indhold (fra SettingsPanel) | Data |
|---|---|---|
| `GeneralSection.jsx` | `GeneralTab` + general-state, `canSave`, `handleSaveGeneral`/`Reset` | workspace-kontekst, `/api/settings/test-mode` |
| `AiInstructionsSection.jsx` | `AiInstructionsTab`, `AiPromptModal` | `/api/persona` |
| `MembersSection.jsx` | `MembersTab`, `StoreTeamRow` | `members` fra kontekst, `reload` efter ændring |
| `EmailSection.jsx` + `email/*.jsx` | `EmailSettings` delt i fem undersektions-komponenter; signatur-builder-helpers i `email/signature-builder.js` | via `EmailSettingsProvider` |
| `ProfileSection.jsx` | `ProfileTab` (er allerede selvstændig) | `/api/settings/theme` |
| `BillingSection.jsx` | `BillingTab` | — |
| mailboxes, tags, automation, customer-satisfaction | eksisterende komponenter, uændrede | — |

`EmailSettingsProvider` ejer email-kladden (auto-reply, signatur, routing, sender rules, blocklist), `canSaveEmailSettings`, `handleSaveEmailSettings` og `handleDiscardEmailSettings`. Fordi den ligger i `email/layout.jsx`, overlever ændringer et skift mellem undersektioner, ligesom i dag hvor de bare er skjult med CSS. Undersektions-menuen og gem-baren renderes i email-layoutet, som i dag.

`SettingsPanel.jsx` slettes, når alle sektioner er flyttet.

### Bevidst ændring: AI-prompt gemmes ikke længere via General (godkendt)

I dag tæller `aiPrompt` med i Generals dirty-tjek, og `handleSaveGeneral` poster `/api/persona`. AI-sektionen gemmer selv via sin modal. Efter splittet ejer kun AI-sektionen prompten. Det er en kobling uden selvstændig funktion. Effekten er kun synlig, hvis man har redigeret prompten uden at gemme i modalen og derefter trykker gem i General.

## Ugemte ændringer

`SettingsShell` eksponerer `useSettingsDirty(isDirty, discard)`, som sektionerne kalder. Shell'en bevarer de to nuværende adfærd:

- `beforeunload`-advarsel, mens den aktive sektion har ugemte ændringer.
- Klik på et andet menupunkt (desktop-link eller mobil-select) → `window.confirm("Discard your unsaved changes?")`. Ved ja kaldes `discard()` og der navigeres. Ved nej bliver man.

Skift mellem email-undersektioner advarer ikke (som i dag). Browserens tilbage-knap advarer heller ikke i dag (pushState), og det ændres ikke.

## Fejl og loading

- Workspace-kontekst loader → sektionens indholdsområde viser det nuværende `TabSkeleton`. Menuen vises med det samme, som i dag.
- Fejl i workspace-opslag (401/403/404 på members) → samme fejltilstand som i dag.
- Sektionsdata fejler → samme toast/fallback som den nuværende kode for den ressource.

## Test og evidens

**Unit (vitest):**
- `legacySettingsPath`: alle tabs, email-sections, `mailbox_id`, ukendte værdier.
- `isSettingsSectionPath`: sektioner sand, builders falsk.
- Ressource-map: bootstrap-ressourcer kan læses synkront under deres URL. En manglende eller fejlet ressource hentes én gang. `setResource` erstatter værdien.

**Manuelt på localhost mod dev (evidens i PR):**
- Screenshots før og efter af hver sektion og email-undersektion (desktop + mobilbredde), taget lokalt og ikke uploadet.
- Pr. sektion: indlæsning, redigér → gem → reload viser gemt værdi → sæt tilbage. Redigér → fortryd.
- Ugemte ændringer: advarsel ved skift af sektion og ved reload. Email-kladden overlever et skift af undersektion.
- Gamle links: `/settings?tab=email&section=routing`, `/settings?tab=customer-satisfaction`, builder-back-links.
- Network: første visning laver ét bootstrap-kald, ikke ét pr. ressource. Et sektionsskift laver nul kald og viser ingen skeleton (bekræftes i Network-fanen og visuelt).
- Hurtighed: tid fra klik til færdigrenderet sektion måles før og efter (Performance-fanen eller `performance.now()` omkring navigation). Efter må ikke være langsommere.

`npm test` og `npm run build` i `apps/web` skal være grønne.

## Leverance

Én PR, men committet sektion for sektion (navigation/redirect → shell + kontekst → én commit pr. sektion → sletning af `SettingsPanel`). Den kan dermed reviewes og bisectes trinvis.
