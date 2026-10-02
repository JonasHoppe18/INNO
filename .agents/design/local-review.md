# Lokalt designreview

Forsøgsbranch: `codex/sona-design-local-1002b`. Base: `origin/main` ved `4042e513`. Ingen push eller ny PR. Den tidligere dokument-PR #85 er lukket.

## Hvad ændringen gør

Layout, panelbredder, typografi og funktioner bevares. Fælles tokens samler varm neutral canvas, hvide paneler, violet primary/selection og statusfarver med light/dark-par. Settings arver globale tokens. Inboxens composer, samtalerækker, tabs og status-control bruger dem også. Fælles UI-komponenter ejer hover, focus og disabled.

De eksisterende sider indeholder stadig enkelte hardcodede farver. De skal gennemgås før godkendelse til et fuldt rollout. SonaActivityContent og KnowledgeCategoriesClient, som er i en anden åben PR, er ikke ændret.

## Lokal kørsel

Fra worktreets rod:

```sh
ulimit -n 8192
npm --workspace apps/web run dev -- --hostname localhost --port 3106
```

Brug den ignorerede dev-`.env.local`, og lad `NEXT_PUBLIC_DASHBOARD_URL` matche `http://localhost:3106`. Serveren er bundet til localhost. På denne maskine bruger forsøget `SONA_DESIGN_DISABLE_WEBPACK_CACHE=1` for at undgå en stor diskcache. Det er et valgfrit lokalt flag, ikke et krav for produktet.

- `http://localhost:3106/inbox` viser det eksisterende produktlayout.
- `http://localhost:3106/design-lab` viser faktiske shared controls og samtalerækker med fiktive data. Composer-eksemplet bruger Textarea og Button, ikke den fulde composer.

## Verifikation

| Check | Resultat | Evidens / begrænsning |
| --- | --- | --- |
| Produktionsbuild | Bestået | Compile, lint/typecheck og 161 statiske sider. Webpack advarer om dynamiske imports i MJML-afhængigheder |
| Lint for ændrede JSX-filer | Bestået | Ingen warnings eller errors i de målrettede checks |
| `git diff --check` | Bestået | Ingen whitespace-fejl |
| Shared controls, light/dark | Bestået | Browseren viser begge paletter; primary og status er målt på faktisk renderede elementer |
| Settings token-arv | Bestået | `--primary` er identisk på root og `.settings-theme` i begge temaer |
| Kontrast | Bestået for målte par | 14 renderede tekst/baggrund-par er mindst 5.07:1. Light primary 5.47:1, dark primary 7.64:1 |
| Dialog og Select | Bestået | Popover bruger samme palette. Dialog åbner, Escape lukker og fokus vender tilbage til trigger |
| Lokal preview-feedback | Bestået | "Save preview" viser "Saved in this preview only". Ingen backend-write-handler |
| Faktiske produktsider | Gennemgået | Inbox med dev-fixture, Customers, Settings og Knowledge åbnet i lokal browser mod dev |
| Layout | Gennemgået | Samme inbox-rail, kønavigation, liste, tabs, besked og composer. Ingen panelbredder flyttet |
| Desktop overflow | Bestået i design-lab | Faktisk viewport 1470 px, ingen horisontal overflow |
| Smal viewport | Ikke verificeret | Browserens override til 390 px ændrede ikke faktisk `innerWidth`. Override nulstillet; der påstås ingen mobiltest |
| Komplet keyboard-/sideaudit | Ikke udført | Første designforsøg. Alle legacy-overrides, 200 % zoom og fuldt workflow skal gennemgås før PR |

Screenshots og målte farver ligger lokalt i `/tmp/sona-design-local-1002b-evidence/`. Kun design-lab med fiktive data er gemt som screenshots. Ingen upload.

De første runtime-forsøg ramte lav diskplads, en grænse for åbne filer og rester fra genstart/build. Oprydning omfattede kun forsøgets genererede `.next`-filer. Den afsluttende build bestod efter en ren start; dev-serveren blev derefter startet alene med højere procesgrænse og korrekt localhost-origin.

Ingen mails er sendt, og der er ikke ændret agent-, automation-, V2- eller database-logik. Ingen deploy er udført.

## Typografi — lokalt gennemløb

Inter 4.1 normal og italic indlæses via next/font/local. SIL OFL følger fontfilerne. Dashboardets UI-tekst bruger 13/20 px, metadata 12/16 px, længere tekst 14/20 px og sidetitler 16/24 px. Vægte er 450/550/650; root-rem er fortsat 16 px. Sidetitelstørrelsen er Sonas lokale fortolkning af referencen.

- Produktionsbuild efter typografiændringer: bestået, inklusive lint, typecheck og 161 sider. Samme MJML-warnings som før.
- Separat tsc --noEmit: bestået. Lint af ændrede JSX-filer: bestået.
- Browsermåling Customers: tabel og søgefelt 13/20 px, vægt 450; titel 16/24 px, vægt 650. Ingen horisontal overflow.
- Settings: General-overskrift 16 px, navigation og input 13 px.
- Inbox med eksisterende DEV Customer-fixture: contenteditable svar-editor 14/21 px. Ingen tekst indtastet eller mail sendt. Ingen horisontal overflow.
- Design-lab: alle fire skalaroller målt i computed styles, med Inter-familien fra lokal font-loader. Lokalt screenshot: /tmp/sona-design-local-1002b-evidence/06-inter-light-components.png.
- Radix-dialog efter genstart: Inter, body og knapper 13 px, titel 16 px. Light og dark vist i design-lab; mobil og fuldt sideaudit er stadig ikke verificeret.
- PR80-filerne SonaActivityContent.jsx og KnowledgeCategoriesClient.jsx er ikke redigeret; deres lokale pixel-overrides kræver senere afstemning.

Ingen push eller ny PR.

## Inbox-polish efter review

- Status, assignee, More og View details bruger samme styling. Browsermål: alle 28 px høje, tekst 13 px / vægt 450, hvid baggrund, neutral kant og ingen skygge.
- Statusmenu åbnet med alle fire options. Escape lukker og returnerer fokus; ingen status ændret.
- Composer-skygge målt til 4/16 px ved 4 % og 1/3 px ved 3 %.
- Læste tickets og metadata lettere; ulæste navne beholder vægt 650. Replied-label og mindre cap på metadata giver emnet mere plads uden ændrede panelbredder.
- Målrettet lint for fire ændrede komponenter bestået; diff-check bestået. Browser viser ingen horisontal overflow i desktop-inbox.
- Kun dev-fixture brugt til samtalekontrol. Intet sendt, ingen statusmutation. Ingen push eller PR.
