# UI-designsystem

Dette dokument er implementeringsreglerne for Sonas valgte design. Læs [design.md](design.md) for retning og fælles mønstre. Brugeren har valgt kortvarianten og godkendt push den 5. oktober 2026. Brug reglerne til nye sider og komponenter på designbranchen; PR og merge er ikke godkendt.

Kilder til implementerede værdier på branchen er `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` og `apps/web/components/ui/`. Dokumentet beskriver denne branch, ikke den nuværende prod-UI.

## Stack og layout

- Behold shadcn new-york, Radix, CVA, `cn` og Lucide. Nye controls bruger eksisterende `components/ui`.
- Inter 4.1 indlæses lokalt via `next/font/local` (normal og italic, variabel vægt). Behold `--radius: 0.5rem`.
- Behold inboxens rail, kønavigation, samtaleliste, tabs, beskeder og composer. Behold panelrækkefølge og funktioner. Alle dashboard-sider bruger samme kompakte desktop-tæthed valgt ved lokalt review.
- Behold eksisterende spacing. Mobilnavigation og controls skal være tilgængelige uden klipning. Farvearbejde er ikke tilladelse til at redesigne siderne.

## Typografi

Fonten er Inter, samme familie som Shopifys publicerede Polaris-tokens. Den tidligere CSS navngav Inter uden at indlæse fonten. Fontfiler og SIL Open Font License ligger i `apps/web/app/fonts/`. Ingen font-request til tredjepart ved runtime.

| Rolle | Klasse | Størrelse / linjehøjde | Vægt |
| --- | --- | --- | --- |
| Navigation, controls, tabeller | `text-sm` | 12 / 18 px | 450; labels 550 |
| Metadata og hjælpetekst | `text-xs` | 12 / 16 px | 450 |
| Længere læsetekst | `text-base` | 0.875rem / 1.25rem; 12.6 / 18 px på kompakt desktop | 450 |
| Samtalebeskeder og composer-tekst | `text-sm leading-[1.5]` | 12 / 18 px | 450 |
| Redigerbare felter | `text-input md:text-sm` | 16 / 20 px mobil; 12 / 18 px desktop | 450 |
| Sidetitel | `text-page-heading` | 16 / 24 px | 650 |
| Sektionsoverskrift | `text-section-heading` | 14 / 20 px | 650 |

Brug de fælles roller frem for nye `text-[Npx]`. Størrelser må variere efter rolle, men samme rolle skal have samme størrelse. `font-normal`, `font-medium` og `font-semibold` bruger 450, 550 og 650 i dashboardet, som de publicerede Polaris-fonttokens. Mobil-inputs beholder 16 px for at undgå automatisk zoom.

Skalaen aktiveres på dashboard og design-lab via CSS-variabler; Radix-overlays i body følger samme tokens. Root-rem er normalt 16 px. Alle dashboard-sider og design-lab bruger 90 % root-størrelse fra 1024 px, så navigation, controls og rem-baserede afstande har samme tæthed på tværs af sider. UI-tekst og metadata er faste 12 px; sidetitler 16 px og sektionstitler 14 px skaleres heller ikke ned. Nøgletal beholder deres større tekstroller. Mobil beholder 16 px root-størrelse og større inputtekst. Dashboard-kort må have mere luft end ticketlisten. Composerens automatiske højde og resize-minimum følger samme tæthed. Marketingens eksisterende skala bevares. Rich text med eksplicit formatering og kode/ID i monospace bevarer deres rolle.

Shopifys offentlige [designregler](https://shopify.dev/docs/apps/design/visual-design#typography) angiver mindst 13 px til body/controls og 12 px til captions. [Polaris-fonttokens](https://github.com/Shopify/polaris-react-archive/blob/main/polaris-tokens/src/themes/base/font.ts) dokumenterer Inter og vægtene. Sonas 12 px UI-tekst er valgt efter lokalt review og afviger fra Shopifys body-minimum. Sonas 16 px sidetitel er vores lokale fortolkning af den kompakte reference, ikke en verificeret måling af den nyeste Shopify-admin.

`SonaActivityContent.jsx` og `KnowledgeCategoriesClient.jsx` ejes af den åbne PR80 og er ikke redigeret her. Deres standardklasser arver skalaen; deres egne pixelstørrelser og større headings kræver et senere gennemløb efter afklaring af PR80.

## Fælles farver

Brug semantiske Tailwind-klasser. Hex-værdier må kun stå i designreference eller ændres via token-definitionen. Tilføj ikke nye violet/indigo/purple-nuancer i de enkelte komponenter.

| Rolle | Klasser | Regel |
| --- | --- | --- |
| Appens canvas | `bg-background`, `text-foreground` | Hvid i light, flad mørk neutral i dark |
| Samtaleområdet | `bg-conversation` | Varm grå #F8F7F5 i light, bag beskeder og composer. Dark følger eksisterende neutrale baggrund |
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

- Inbox-toolbarens status, assignee, More og View details deler `ticketToolbarControlClass`: h-7 høj (28 px ved normal tæthed, 25.2 px på desktop), 12 px tekst med arvet Inter-font, almindelig vægt 450 og foreground-tekst. Controls er flade uden kant, baggrund eller skygge; hover bruger muted og keyboard-fokus bruger den fælles ring. Ikoner bruger size-3.5 (14 px ved normal tæthed, 12.6 px på desktop) med stroke 1.75; controls bruger rounded-md. Ticketnummeret i headeren bruger samme Inter og almindelige vægt med tabular nums, ikke monospace. Status vises med label og ikon; toolbaren bruger ikke farvede badges. Badge-farverne gælder fortsat andre statusvisninger.
- Ticketlisten, dens toolbar og loading-skeleton deler --ticket-list-width: clamp(16rem, 18vw, 21rem), så bredderne flugter.
- Ticketlistens afsender, emne og metadata bruger 12 px. Søgning på desktop og sortering bruger også 12 px; mobilens søgefelt beholder 16 px for at undgå zoom. Trelinje-layout uden avatar: emne og dato øverst, afsender i normal vægt på anden linje, kundens seneste besked i grå med status og ticketnummer til højre nederst. Preview er ren tekst, afkortet til én linje, og udelukker egne svar, interne afsendere og kladder. Beskedtekst hentes kun for det virtuelle vindue med eksisterende workspace-scope. Emnet bruger vægt 550, ulæst emne 650; afsender, preview og metadata bruger vægt 450. Ticketnumre bruger Inter med tabular nums. Fast rækkehøjde 76 px, px-4 pt-3 pb-2 og gap-1. Metadata har mt-auto og ligger i bunden med padding. Ventetidslabels som 37d vises ikke; køernes sorteringslogik bevares. Valgt kortvariant: 4 px mellem rækkerne, bg-card, svag kant og ingen skygge, på bg-conversation. Virtualiseringens estimat er 80 px inklusive mellemrum; sidste spacer trækker sidste mellemrum fra. Snapshot b46e9ced bevarer den tidligere sammenhængende liste som reference. "Customer replied" vises kompakt som "Replied" med fuld label tilgængelig via title/aria-label. Emner har tooltip med hele teksten.
- Confirmation-mails med en verificeret sendt-event vises som en diskret, højrestillet "Confirmation email sent"-linje i `text-sm` og `text-muted-foreground`. Sammenklappet visning har kun label, Reply-ikon og chevron i en kompakt knap, som følger indholdets bredde. Ingen previewtekst. Klik eller Enter folder den eksisterende beskedvisning ud. Udfoldede confirmation-mails bruger svagt lilla `bg-primary/5` og diskret lilla `border-primary/20`. Tidspunktet vises i disclosure-linjen; udfoldet indhold viser ikke en ekstra afsender-/tidslinje. Brug ghost-knap, Reply-ikon og chevron. Aktivering af confirmation-mails alene må ikke vise en sendt-markering.
- Sendte CSAT-mails vises med samme diskrete metadata-stil som confirmation-linjen: MailCheck-ikon, "CSAT email sent" og afsendelsestidspunkt. Kun `sent`/`responded` med et registreret `sent_at` må vises. Visningen er en statuslinje; CSAT-mailens indhold gemmes ikke i tråden.
- Composer har centreret max-bredde på 56 rem. Tomt svar har 140 px minimumshøjde ved normal tæthed, 126 px i kompakt desktop-inbox; højden vokser med teksten. Composerens skygge er 4/16 px ved 4 % og 1/3 px ved 3 %. Sekundære controls og beskedhandlinger bruger regular vægt.
- Standardknapper og felter deler h-9; kompakte knapper og inbox-toolbar deler h-7. Navigation bruger fælles sidebar-components. Brug størrelsesvarianter frem for lokale højde- og tekst-overrides.
- `Button` ejer farver, hover, fokus og disabled. Brug variants; `className` bruges til lokal størrelse og placering. Den runde send-knap beholder sin størrelse og form, men arver primary.
- `Input`, `Select` og `Textarea` bruger card-baggrund, inputkant og samme fokusring. Behold labels og eksisterende validering. `aria-invalid` markerer kant og fokus med destructive; fejltekst forbindes med `aria-describedby`.
- Sidebar og tabeller bruger neutral hover og svag violet selection. Aktive tabs bruger accenttekst eller primary-markering afhængigt af deres eksisterende mønster.
- Settings-menuen markerer det valgte punkt med accentbaggrund og tekst. Ingen lodret streg eller inset-skygge.
- Ændr fælles komponenter først. Et override på en enkelt side skal have en konkret funktionel grund.
- Customers, Analytics, Integrations, Settings og de øvrige Knowledge-komponenter bruger nu fælles semantiske farver. PR80-filerne er fortsat undtaget. Logoer, chart-serier, brugerens tagfarver, formateret brugerindhold og theme-picker-miniaturer må beholde egne farver.

## Motion og evidens

Behold eksisterende kurve `cubic-bezier(0.23, 1, 0.32, 1)` og korte UI-overgange. Ingen `transition: all`. Respektér `prefers-reduced-motion`.

Lokal review foregår i appen og på `/design-lab`. Design-lab er kun tilgængelig under `next dev`, bruger fiktive data og har ingen backend-write-handlinger. Behold normal authentication.

Screenshots og testresultater gemmes lokalt. Kunde-mails, PII og shop-data må ikke uploades til offentlige hosts. Push af den valgte designbranch er godkendt. Opret eller merge ikke PR uden separat instruks.

## Sidekontrol før review

- Brug fælles tekstroller, knapvarianter og tokens til hover, selection, status og fokus. Nye lokale farvepaletter kræver en dokumenteret undtagelse.
- Kontroller light/dark, keyboard-fokus, dropdowns og fejltekst i faktisk renderede controls.
- På mobil har sider uden inboxens SiteHeader en fælles navigationstrigger. Felter bruger text-input; brede tabeller får lokal overflow-x-auto.
- Bevar desktop-layoutet og undgå horisontal overflow på hele siden. Se [local-review.md](design/local-review.md) for gennemførte checks og begrænsninger.

## Nye sider

1. Genbrug DashboardPageShell og den eksisterende dashboard-navigation. Tilføj ikke en ny font eller et parallelt sæt tokens.
2. Brug text-page-heading til sidetitlen, text-section-heading til sektioner og text-sm til almindelig tekst. Behold større nøgletal, når deres rolle kræver det.
3. Brug Button, Input, Textarea, Select, Tabs, Table og Card fra components/ui. Vælg default, outline eller ghost efter handlingens rolle.
4. Brug bg-background på almindelige sider, bg-card på kort og bg-conversation på inboxens arbejdsflader. Tætte opgavelister kan genbruge ticketkort-mønstret; tabeller beholder tabel-layoutet.
5. Standard-controls deler h-9: 36 px normalt og 32.4 px på kompakt desktop. Kompakte controls deler h-7: 28 px normalt og 25.2 px på desktop. Størrelsen må følge rollen, men samme rolle skal have samme størrelse på tværs af sider.
6. Labels og status skal være læsbare uden kun at stole på farve. Behold keyboard-fokus og fejlbeskeder. Ingen lokale farve- eller tekst-overrides uden en dokumenteret grund.
7. Kontroller light/dark, mobilnavigation, loading, tomt indhold og lange labels. Skeleton skal følge det endelige layouts bredde og placering. Undgå en ekstra synlig loading-label, når skeleton allerede kommunikerer indlæsning.
8. Ved ændring af rækkehøjde eller afstand i virtualiserede lister: opdater både rendering og spacer-beregning. Inboxkort er 76 px med 4 px mellemrum, altså 80 px stride.

UI må genbruge eksisterende workspace-scopede læseflows til nødvendig visning som previews. Designarbejde ændrer ikke afsendelse, statuslogik, actions eller automation.
