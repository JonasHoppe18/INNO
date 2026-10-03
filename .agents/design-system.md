# UI-designsystem

Denne branch indeholder et lokalt designforsøg, som ikke er godkendt til merge. Retningen og kilderne står i [design.md](design.md). Arbejdet bevarer Sonas eksisterende layout og afprøver fælles farver og komponentregler.

Kilder til implementerede værdier på branchen er `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` og `apps/web/components/ui/`. Dokumentet beskriver denne branch, ikke den nuværende prod-UI.

## Stack og layout

- Behold shadcn new-york, Radix, CVA, `cn` og Lucide. Nye controls bruger eksisterende `components/ui`.
- Inter 4.1 indlæses lokalt via `next/font/local` (normal og italic, variabel vægt). Behold `--radius: 0.5rem`.
- Behold inboxens rail, kønavigation, samtaleliste, tabs, beskeder og composer. Ingen ændring af panelbredder, placering eller funktioner i dette forsøg.
- Behold eksisterende spacing og responsive adfærd. Farvearbejde er ikke tilladelse til at redesigne siderne.

## Typografi

Fonten er Inter, samme familie som Shopifys publicerede Polaris-tokens. Den tidligere CSS navngav Inter uden at indlæse fonten. Fontfiler og SIL Open Font License ligger i `apps/web/app/fonts/`. Ingen font-request til tredjepart ved runtime.

| Rolle | Klasse | Størrelse / linjehøjde | Vægt |
| --- | --- | --- | --- |
| Navigation, controls, tabeller | `text-sm` | 13 / 20 px | 450; labels 550 |
| Metadata og hjælpetekst | `text-xs` | 12 / 16 px | 450 |
| Længere tekst og svar-editor | `text-base` | 14 / 20 px (editor 1.5) | 450 |
| Sidetitel | `text-page-heading` | 16 / 24 px | 650 |
| Sektionsoverskrift | `text-section-heading` | 14 / 20 px | 650 |

Brug de fælles roller frem for nye `text-[Npx]`. Størrelser må variere efter rolle, men samme rolle skal have samme størrelse. `font-normal`, `font-medium` og `font-semibold` bruger 450, 550 og 650 i dashboardet, som de publicerede Polaris-fonttokens. Mobil-inputs beholder 16 px for at undgå automatisk zoom.

Skalaen aktiveres på dashboard og design-lab via CSS-variabler; Radix-overlays i body følger samme tokens. Root-rem forbliver 16 px, så spacing ikke skaleres ned. Marketingens eksisterende skala bevares. Rich text med eksplicit formatering og kode/ID i monospace bevarer deres rolle.

Shopifys offentlige [designregler](https://shopify.dev/docs/apps/design/visual-design#typography) angiver mindst 13 px til body/controls og 12 px til captions. [Polaris-fonttokens](https://github.com/Shopify/polaris-react-archive/blob/main/polaris-tokens/src/themes/base/font.ts) dokumenterer Inter og vægtene. Sonas 16 px sidetitel er vores lokale fortolkning af den kompakte reference, ikke en verificeret måling af den nyeste Shopify-admin.

`SonaActivityContent.jsx` og `KnowledgeCategoriesClient.jsx` ejes af den åbne PR80 og er ikke redigeret her. Deres standardklasser arver skalaen; deres egne pixelstørrelser og større headings kræver et senere gennemløb efter afklaring af PR80.

## Fælles farver

Brug semantiske Tailwind-klasser. Hex-værdier må kun stå i designreference eller ændres via token-definitionen. Tilføj ikke nye violet/indigo/purple-nuancer i de enkelte komponenter.

| Rolle | Klasser | Regel |
| --- | --- | --- |
| Appens canvas | `bg-background`, `text-foreground` | Hvid i light, flad mørk neutral i dark |
| Kort, composer og overlays | `bg-card`, `bg-popover` | Hvidt i light, lidt lysere panel i dark |
| Primær handling | `bg-primary`, `text-primary-foreground` | Samme violet i hele appen. Dark bruger lys violet med mørk tekst |
| Valgt element | `bg-accent`, `text-accent-foreground` | Svag violet. Bruges til selection, ikke almindelig hover |
| Neutrale grupper og hover | `bg-muted`, `text-muted-foreground` | Hover skal kunne skelnes fra valgt element |
| Sidebar | `bg-sidebar` og `sidebar-*` | Hvid i light; samme brand og statusregler som indholdet |
| Borders og inputs | `border-border`, `border-input` | Svag opdeling, tydeligere kant på felter |
| Fokus | `ring-ring`, `ring-offset-background` | Synligt keyboard-fokus i begge temaer |

`.settings-theme` har ikke længere egne token-overrides. Settings skal arve samme farver som inbox og øvrige sider. Radix-portaler arver globale tokens, så popovers ikke får et andet tema end deres trigger.

## Status og AI

Statusfarver defineres via `success`, `warning`, `info` og `danger` med `foreground` og `border` for hvert tema. Brug `Badge`-varianter eller `badgeVariants` i custom controls.

| Betydning | Badge-variant |
| --- | --- |
| Needs attention | `info` |
| Waiting on customer | `neutral` |
| Waiting on third party / afventer godkendelse | `warning` |
| Resolved / tilsluttet / gemt | `success` |
| Sona-udkast og AI | `ai` |
| Fejl | `danger` |
| Destruktiv handling | `Button variant="destructive"` |

Labels skal altid følge farven. Godkendt, godkendt i testtilstand og udført er forskellige tilstande. Status-/action-logik må ikke ændres som del af styling.

## Controls

- Inbox-toolbarens status, assignee, More og View details deler `ticketToolbarControlClass`: 28 px høj, 13 px tekst, almindelig vægt 400, foreground-tekst, neutral card-baggrund og ingen skygge. Ikoner er 14 px med stroke 1.75; radius er 6 px. Ticketnummeret i headeren bruger Inter Regular med tabular nums, ikke monospace. Status vises med label og ikon; toolbaren bruger ikke farvede badges. Badge-farverne gælder fortsat andre statusvisninger.
- Ticketlisten bruger vægt 450 til læste afsendere og metadata, 650 til ulæste afsendere og 550 til ulæste emner. "Customer replied" vises kompakt som "Replied" med fuld label tilgængelig via title/aria-label. Emner har tooltip med hele teksten.
- Composerens skygge er 4/16 px ved 4 % og 1/3 px ved 3 %. Sekundære controls og beskedhandlinger bruger regular vægt.
- `Button` ejer farver, hover, fokus og disabled. Brug variants; `className` bruges til lokal størrelse og placering. Den runde send-knap beholder sin størrelse og form, men arver primary.
- `Input`, `Select` og `Textarea` bruger card-baggrund, inputkant og samme fokusring. Behold labels og eksisterende validering.
- Sidebar og tabeller bruger neutral hover og svag violet selection. Aktive tabs bruger accenttekst eller primary-markering afhængigt af deres eksisterende mønster.
- Ændr fælles komponenter først. Et override på en enkelt side skal have en konkret funktionel grund.
- Ikke alle gamle hardcodede farver er migreret. Gennemgå dem side for side før godkendelse; dette forsøg er første fælles gennemløb.

## Motion og evidens

Behold eksisterende kurve `cubic-bezier(0.23, 1, 0.32, 1)` og korte UI-overgange. Ingen `transition: all`. Respektér `prefers-reduced-motion`.

Lokal review foregår i appen og på `/design-lab`. Design-lab er kun tilgængelig under `next dev`, bruger fiktive data og har ingen backend-write-handlinger. Behold normal authentication.

Screenshots og testresultater gemmes lokalt. Kunde-mails, PII og shop-data må ikke uploades til offentlige hosts. Ingen push eller PR før brugeren har godkendt forsøget.
