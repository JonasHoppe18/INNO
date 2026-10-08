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

Hver sektion får sin egen URL (`/settings/general`, `/settings/email/routing` …). De serveres alle af **én optional catch-all-rute**, og der navigeres client-side mellem dem:

```
app/(dashboard)/settings/
  [[...slug]]/page.jsx          → erstatter page.jsx; redirecter gamle links, ellers renderer den SettingsWorkspace
  csat/…  confirmation/…        → uændret; statiske segmenter vinder over catch-all
```

**Hvorfor ikke én mappe pr. sektion:** `(dashboard)/layout.jsx` er dynamisk (Clerk `auth()`, `cookies()`), og `(dashboard)/loading.jsx` er en global skeleton. Med separate route-segmenter ville første besøg på hver sektion kræve en tur til serveren, og dashboard-skeletonen ville vises imens. I dag er et faneskift øjeblikkeligt. Catch-all + `window.history.pushState` bevarer det. Next 14.2 synkroniserer `pushState` med `usePathname`, så aktiv sektion udledes af URL'en uden server-tur.

`[[...slug]]/page.jsx` er en server-komponent:
- uden slug og med `?tab=` → `redirect(legacySettingsPath(searchParams))`
- uden slug og uden `?tab=` → `redirect("/settings/general")`
- slug, der ikke er en kendt sektion (`parseSettingsSlug` returnerer `null`) → `redirect("/settings/general")`
- ellers → `<SettingsWorkspace />` (client)

`/settings/email` uden undersektion → `/settings/email/auto-reply`.

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

- `SETTINGS_NAV`: grupperne og punkterne fra `MENU_SECTIONS` (key, label; ikonerne mappes i shell'en)
- `EMAIL_SECTIONS`: fra den nuværende fil
- `parseSettingsSlug(slug)`, `settingsPath(section, emailSection?)`, `legacySettingsPath(searchParams)`, `isSettingsSectionPath(pathname)`

`SettingsShell` renderer desktop-menuen og mobil-`<select>` præcis som i dag. Aktiv sektion udledes af `usePathname()` via `parseSettingsSlug` i stedet for `activeTab`-state. Menupunkter og mobil-select navigerer med `window.history.pushState(null, "", settingsPath(section, emailSection))`, ligesom i dag, bare med nye stier. Der er ingen server-tur og ingen skeleton.

## Data: workspace-kontekst + sektioner der henter selv

### SettingsWorkspaceProvider (i sections-layoutet)

Ejer kun *hvem er jeg* og bruges af flere sektioner. Den indeholder den nuværende opslagslogik fra `loadData` (members-respons → workspace-id, navn, rolle, support-sprog; fallback via `profiles`/`workspaces`/`workspace_members`/`shops`), flyttet uændret.

Eksponerer: `{ loading, error, workspaceId, shopId, shopDomain, supabaseUserId, workspaceName, currentRole, canManageMembers, members, reload, setWorkspaceName }`.

Den kalder `/api/settings/bootstrap` én gang og gemmer svaret i et ressource-map i provideren (`resources[url] = { ok, status, payload }`). Kortet lever, så længe man er inde på settings-ruterne, fordi `SettingsWorkspace` ikke unmountes ved sektionsskift. Det har ingen TTL og ingen baggrunds-genhentning, ligesom i dag hvor alt hentes én gang pr. sidevisning.

Sektionerne læser via `useSettingsResource(url)`, som returnerer data synkront fra kortet. Hvis ressourcen mangler eller fejlede i bootstrap, henter hooken den via `readResponse` og lægger den i kortet. Efter et vellykket gem kalder sektionen `refreshResource(url)`. Den henter GET-ressourcen i baggrunden og erstatter værdien i kortet, så den næste visning af sektionen viser det gemte uden skeleton. Den mountede sektion bliver ved med at vise sin egen kladde.

`scopedReadCache` (TTL 15 s) bruges ikke til settings, fordi dens udløb ville give skeleton-blink ved sektionsskift.

### Sektionerne

Hver sektion er en komponent i `components/settings/sections/` med sit eget state, sin indlæsning via `readJson`, sin kladde, dirty-beregning og gem-handler. De flyttes uændret fra den nuværende fil:

| Fil | Indhold (fra SettingsPanel) | Data |
|---|---|---|
| `GeneralSection.jsx` | `GeneralTab` + general-state, `canSave`, `handleSaveGeneral`/`Reset` | workspace-kontekst, `/api/settings/test-mode` |
| `AiInstructionsSection.jsx` | `AiInstructionsTab`, `AiPromptModal` | `/api/persona` |
| `MembersSection.jsx` | `MembersTab`, `StoreTeamRow` | `members` fra kontekst, `reload` efter ændring |
| `email/EmailSection.jsx` + `email/EmailSettings.jsx` | email-state og handlers; `EmailSettings`-viewet flyttes intakt (opdeling i fem undersektions-komponenter hører til trin 2); signatur-builder-helpers i `email/signature-builder.js`; række-normalisering i `lib/settings/email-rows.js` | ressource-kortet |
| `ProfileSection.jsx` | `ProfileTab` (er allerede selvstændig) | `/api/settings/theme` |
| `BillingSection.jsx` | `BillingTab` | — |
| mailboxes, tags, automation, customer-satisfaction | eksisterende komponenter, uændrede | — |

`EmailSection` ejer email-kladden (auto-reply, signatur, routing, sender rules, blocklist), `canSaveEmailSettings`, `handleSaveEmailSettings` og `handleDiscardEmailSettings`. `EmailSection` forbliver mounted, når man skifter undersektion (kun `emailSection` i URL'en ændres). Kladden overlever derfor skiftet, ligesom i dag hvor undersektionerne bare er skjult med CSS. Undersektions-menuen og gem-baren renderes af `EmailSection`, som i dag.

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
- Ressource-map: bootstrap-ressourcer (også fejlede) lander under deres URL; manglende URL'er identificeres til direkte hentning (workspace-only-ressourcer kun med workspace).

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
