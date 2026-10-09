# Settings-redesign — design

Dato: 2026-10-08 · Branch: `feat/settings-redesign-1008` · Status: til review
Forudsætning: settings-split (PR #107, merget).

## Formål

Trin 2 af settings-oprydningen: ét visuelt udtryk for alle sektioner, i samme stil som inboxen. Godkendt skabelon er General-prototypen på branchen (commit `9d8cf6c2`).

Siden er i dag rodet, fordi hver sektion styler sig selv: fire kort-varianter, tre sidetitel-varianter, fire gem-mønstre og ikon-cirkler i rækker. Efter redesignet bygges alle sektioner af de samme fem byggeklodser, og en sektion må ikke style sine egne overflader, overskrifter eller rækker.

**Succeskriterium:** alle ti sektioner (og fem email-undersektioner) følger skabelonen. Ingen funktionalitet forsvinder, og sektionsskift er stadig øjeblikkelige.

## Ikke i scope

- Gruppering, rækkefølge og navne i menuen (trin 3).
- Ændringer i API'er eller i, hvad der gemmes.
- CSAT- og confirmation-email-builderne (egne fuldskærmssider).
- Indholdet af `AutomationPanel` (agent-komponent, delt med andre sider). Den får kun sidehovedet.
- Den app-brede `text-input`-farvefejl (separat PR; se nedenfor).

## Visuelt udtryk (godkendt)

- **Flade:** indholdet ligger på inboxens arbejdsflade `bg-conversation`. Menuen til venstre er hvid. I dark mode følger fladen baggrunden.
- **Kolonne:** centreret, max 720 px for formularer og 960 px for tabeller.
- **Ingen kort.** Grupper adskilles af luft (`space-y-9`). Rækker i en gruppe adskilles af hårfine linjer (`divide-border/60`). Den eneste lange linje er under sidehovedet.
- **Hierarki:** sidetitel `text-page-heading` → gruppetitel `text-section-heading` (650) → rækkelabel `text-sm` 550 → hjælpetekst `text-xs` muted.
- **Kontroller:** flugter mod højre i en kontrolkolonne på 256 px. Felter fylder kolonnen, switches og korte felter står yderst til højre. Alle h-8. Felttekst `text-foreground`.
- **Switches:** `SettingsSwitch` (primary når tændt, lyst spor når slukket). Shadcn-switchens grønne farve bruges ikke i settings.
- **Menu-labels:** identiske med inboxens kø-menu (`uppercase tracking-[0.14em] text-muted-foreground/75`).
- **Ingen ikoner i indholdet.** Ikoner bruges kun i menuen og i knapper.

## Byggeklodser (`components/settings/ui/`)

Eksisterer allerede i `settings-layout.jsx`:

| Komponent | Ansvar |
|---|---|
| `SettingsPage` | Sidehoved (titel, beskrivelse, handlinger til højre), kolonnebredde `form`/`wide`, luft mellem grupper |
| `SettingsGroup` | Gruppetitel, valgfri beskrivelse og handling, rækker med hårfine linjer, valgfri footer-note |
| `SettingsRow` | Label og hjælpetekst til venstre, kontrol til højre; stables på mobil |
| `SettingsSwitch` | Brand-farvet switch |
| `SettingsSaveBar` | Flydende "Unsaved changes · Discard · Save changes"-bar, kun ved ændringer, sticky i kolonnen |

Nye:

| Komponent | Ansvar |
|---|---|
| `SettingsTable` | Liste/tabel i samme udtryk: muted 12 px kolonneoverskrifter, hårfine linjer mellem rækker, ingen ramme. Kolonner defineres af sektionen; rækkehandlinger ligger i en `⋯`-menu (`DropdownMenu`) yderst til højre |
| `SettingsEmptyState` | Ens tom-tilstand: stiplet ramme, én linje tekst, valgfri knap |
| `SettingsTabs` | Understregede faner (som Knowledge-siden) til email-undersektionerne; styres af den eksisterende `navigate("email", sub)` |

## Gem-regel

- **Formularer** (General, AI instructions, Customer confirmation, Signatures, Customer satisfaction, Profile) gemmer via én `SettingsSaveBar`. Ingen andre gem-knapper i formularer. `StickySaveBar` bruges ikke længere i settings.
- **Lister** (Members, Tags, Routing, Sender rules, Blocklist, mailboxes) gemmer med det samme pr. handling, med den eksisterende toast. Det er uændret adfærd, men handlingerne flyttes til ens placering: "Tilføj"-knap i gruppens `action`, rækkehandlinger i `⋯`-menuen.
- Undtagelse: Email-undersektionerne Routing, Sender rules og Blocklist gemmer i dag *sammen med* resten af email-kladden via én gem-bar. Den adfærd bevares (de forbliver kladde + `SettingsSaveBar`), fordi en ændring af det er en adfærdsændring uden for scope. De får tabeludtrykket, men ikke straks-gem.

## Sektion for sektion

Indholdet nedenfor er baseret på en gennemgang af sektionernes nuværende felter. Den præcise liste over felter og handlinger verificeres pr. sektion i planen. Intet eksisterende felt eller handling fjernes.

| Sektion | Bredde | Indhold efter redesign |
|---|---|---|
| General | form | Færdig (prototype) |
| Members | wide | Handling "Invite member" i sidehovedet. `SettingsTable`: avatar+navn+email, rolle (kompakt select når man må ændre), signaturstatus; `⋯`: rediger signatur, gensend invitation, fjern. Ventende invitationer som egen gruppe |
| Channels & mailboxes | wide | Gruppe "Connected mailboxes" som `SettingsTable`; "Connect your support email" som `SettingsEmptyState`/knap når der ingen er |
| Tags | wide | Handling "New tag" i sidehovedet. `SettingsTable`: farveprik+navn, beskrivelse/brug; `⋯`: rediger, slet. Eksisterende dialog genbruges |
| AI instructions | form | Modalen fjernes. Prompten redigeres i en `Textarea` direkte på siden (fuld kolonnebredde, egen række uden kontrolkolonne) og gemmes via `SettingsSaveBar` |
| Actions & automation | wide | Kun `SettingsPage`-hoved om den eksisterende `AutomationPanel`; panelets indhold uændret |
| Email | form | `SettingsTabs` for de fem undersektioner under sidehovedet. Confirmation: rækker for aktiv, omfang (mailbox), ticket-reference, emne; beskeden som fuld-bredde felt; link til builder som rækkehandling. Routing/Sender rules/Blocklist: `SettingsTable` + tilføj-række i gruppens `action`. Signatures: rækker for aktiv + builder-felter, preview som fuld-bredde række. Én `SettingsSaveBar` for hele email-kladden |
| Customer satisfaction | form | Rækker: send undersøgelser (switch), forsinkelse (select), afsender/omfang; "Edit email" og "Edit responses" som rækkehandlinger der linker til builderne |
| Profile & appearance | form | Gruppe "Profile": navn, email (read-only), avatar. Gruppe "Appearance": tema som tre små valgfelter i kontrolkolonnen. `SettingsSaveBar` |
| Billing | form | Gruppe "Plan" med rækker for nuværende plan og status (read-only) |

Tekster beholdes, bortset fra hvor de gentages (som "Test mode"-gruppe + "Test mode"-række i prototypen); der fjernes dubletten. Al UI-tekst forbliver engelsk.

## Fejl, loading og tomme tilstande

- Loading: den eksisterende `TabSkeleton` får skabelonens udtryk (sidehoved + grupper af rækker), så skeleton og indhold ligner hinanden.
- Tomme lister bruger `SettingsEmptyState`.
- Fejl beholder deres nuværende toasts.

## Kendt fejl uden for scope

`text-input` (fontstørrelses-token fra design-systemet) kolliderer med Tailwind-farven `input`, så felter med `text-input` uden `text-foreground` viser værdier i grå i hele appen. Settings tilføjer `text-foreground` lokalt. Den rigtige rettelse (i `Input`/`Textarea` eller Tailwind-config) tages i en separat PR, fordi den rører alle sider.

## Test og evidens

- Unit: ingen ny ren logik forventes; eksisterende `lib/settings`-tests skal forblive grønne. Hvis en sektion får ny afledt logik (fx hvilke handlinger en rolle må se i `⋯`-menuen), udtrækkes den som ren funktion med test.
- Manuelt på localhost mod dev (Chrome), pr. sektion: screenshot før/efter, indlæsning, redigér → gem-bar vises → gem → værdien står efter revisit → sæt tilbage; liste-handlinger (tilføj/redigér/slet) på dev-data der oprettes og fjernes igen i samme test.
- Sektionsskift måles igen (skal være som før: ingen skeleton, ingen ekstra kald).
- `npm run build` og `npx vitest run lib/settings` grønne.

## Leverance

Én PR med én commit pr. sektion (efter de fælles byggeklodser), så den kan reviewes sektion for sektion. Ingen merge uden eksplicit instruks.
