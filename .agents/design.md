# Sona designforslag

Status: lokalt designforsøg, afventer gennemgang. Oprettet 2. oktober 2026.

Dette dokument samler designretningen. Brugeren har valgt at bevare Sonas nuværende layout og afprøve farver og fælles komponentmønstre lokalt. [design-system.md](design-system.md) beskriver nu implementeringen på forsøgsbranchen. Forsøget er ikke godkendt til merge.

Branch: `codex/sona-design-local-1002b`. Worktree: `.worktrees/sona-design-local-1002b`. Den tidligere draft-PR #85 er lukket. Denne branch pusher vi ikke, og vi opretter først PR efter brugerens godkendelse.

Start lokalt fra worktreets rod med `npm --workspace apps/web run dev -- --hostname localhost --port 3106`. Hvis serveren rammer `EMFILE`, kør `ulimit -n 8192` i samme terminal før start. Det ændrer kun denne proces og dens børn. Brug kun en ignoreret `.env.local` med dev-konfiguration som beskrevet i [environments.md](environments.md). `NEXT_PUBLIC_DASHBOARD_URL` skal være `http://localhost:3106`, så navigation ikke sender reviewet ud på en anden server. Hvis lokal diskplads er begrænset, kan `SONA_DESIGN_DISABLE_WEBPACK_CACHE=1` slå Webpacks genererede diskcache fra.

Åbn `/inbox` for den rigtige UI og `/design-lab` for fiktive eksempler på shared controls, badges, light/dark, overlays og samtalerækker. Design-lab ændrer ikke backend-data og findes kun under `next dev`.

## Anbefalet retning

Sona skal føles som et gennemarbejdet arbejdsredskab med en tydelig identitet. Jeg anbefaler varme, lyse baggrunde, hvide arbejdspaneler og violet til primære handlinger og aktiv navigation. Farven findes allerede i settings. Vi skal give den samme rolle i hele appen.

Det visuelle løft kommer fra ens afstande, bedre teksthierarki, rolige paneler og præcis feedback. Inbox skal stadig kunne bruges en hel arbejdsdag. Store gradients, store overskrifter og farvede kort overalt vil gøre arbejdet mere uroligt.

Den tidligere [visuelle skitse](design/sona-direction.svg) viser paletteidéen med fiktive data. Den er historisk reference, ikke en ny layoutspecifikation. Den lokale app er nu reviewgrundlaget. Panelernes placering, bredder, typografi og spacing bevares.

| Retning | Udtryk | Vurdering |
| --- | --- | --- |
| Varm neutral + violet | Lys grå med lidt varme, hvidt indhold, violet på handlinger og udvalgte elementer | Anbefalet. Samler den eksisterende settings-identitet med resten af Sona |
| Kølig neutral + blå | Gråblå paneler og blå handlinger | Et alternativ, hvis violet føles for markant. Kræver at settings skifter identitet |
| Neutral + grøn | Neutrale paneler og grønne handlinger | Et alternativ, men grøn vil både være brandfarve og successtatus. Det gør status mindre entydig |

## Inspiration og kilder

Researchdato: 2. oktober 2026. Oversættelsen til Sona er vores forslag, ikke tokens kopieret fra andre produkter.

| Kilde | Verificeret i research | Hvad vi vil bruge i Sona |
| --- | --- | --- |
| [Shopify admin, opdatering 15. september 2026](https://changelog.shopify.com/posts/see-the-shopify-admin-s-new-look) og [navigation](https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview) | Shopify beskriver nye farver, typografi, spacing, ikoner og ramme. Søgning, notifikationer og butiksvælger flytter til sidebar. Navigation kan foldes sammen. Sidekick bliver en flydende chat | En samlet app-ramme og navigation, der kan frigive plads. Sona har allerede en kompakt rail. Vi skal først forbedre den eksisterende struktur. En flydende chat kræver særskilt afprøvning i inbox |
| [Shopify Web på Mobbin](https://mobbin.com/apps/shopify-web-2c0bd6a1-d9cd-4467-8e7b-214f748ea467/42a81476-425f-5572-a7bb-bd3b0134c8ec/screens) | App-opslag og reference-URL åbnet. Skærmbiblioteket endte i "Something went wrong", også efter refresh | Reference til fælles gennemgang. Vi har ikke verificeret de enkelte skærme eller om Mobbin-versionen viser september-opdateringen |
| [Intercom Web på Mobbin](https://mobbin.com/apps/intercom-web-e2b63d2e-e001-426a-93f3-b5bd11346744/6e269961-628f-4a8b-b490-a34aea334a69/screens) | App-opslag og reference-URL åbnet. De enkelte skærme indlæste ikke under research | Reference til næste visuelle gennemgang. Ingen påstande om skærmenes konkrete spacing eller farver |
| [Intercoms inbox-layout](https://www.intercom.com/help/en/articles/7911926-customize-the-inbox-to-suit-you-and-how-you-work-best) og [samtaledetaljer](https://www.intercom.com/help/en/articles/6546031-customize-the-inbox-with-apps) | Officiel dokumentation beskriver chat- og tabellayout samt kundekontekst og tilpasning af detaljer ved samtalen | Bevar sammenhængen mellem kø, samtale og kundekontekst. Lad detaljer kunne skjules, så svaret får plads |

Mobbin er besøgt i browseren med den eksisterende session. Kataloget var tilgængeligt, men skærmbibliotekerne var ikke. Vi mangler derfor en gennemgang af konkrete Mobbin-skærme, før referencerne kan bruges som visuel dokumentation. Vi downloader eller genpublicerer ikke deres skærme i repoet.

## Udgangspunkt i repoet

Værdierne er læst i `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` og `apps/web/components.json`.

- shadcn new-york, Radix, CVA, semantiske CSS-variabler og Lucide er det eksisterende fundament. Det beholder vi.
- Inter er den deklarerede font. Behold den og verificér den indlæste font i browseren ved implementering.
- Light bruger nær-sort primary globalt. `.settings-theme` bruger `252 79% 61%` violet. Dark bruger allerede lysere violet.
- Basisradius er 8 px. Vi beholder den til controls og introducerer tydelige roller for større paneler.
- `app-sidebar.jsx` har en kompakt rail på 68 px. `InboxSplitView.jsx` indeholder både semantiske tokens og særskilte blå, violet, grønne og grå utility-farver.
- Inbox-status bruger i dag blå til `needs_attention`, violet til `waiting_customer`, amber til `waiting_third_party` og grøn til `resolved`. Det skal vurderes samlet før ændring.

Udgangspunktet ovenfor er en kildekodegennemgang af den oprindelige UI. På forsøgsbranchen er lokale komponenter og den rigtige inbox også gennemgået i browseren mod dev.

## Farver og tokens

Alle værdier nedenfor er forslag. Hex er til designreview. Ved implementering konverterer vi til den eksisterende HSL-format uden `hsl()` i CSS-variablerne og bruger semantiske Tailwind-klasser i komponenterne.

| Rolle / CSS-token | Light | Dark | Brug |
| --- | --- | --- | --- |
| `--background` | `#F7F7F5` | `#15151A` | Appens baggrund |
| `--card`, `--popover` | `#FFFFFF` | `#1E1E25` | Arbejdspaneler og overlays |
| `--foreground`, `--card-foreground`, `--popover-foreground` | `#25252D` | `#F4F4F5` | Brødtekst og titler |
| `--muted`, `--secondary` | `#EFEFED` | `#282830` | Neutrale grupper og hover |
| `--muted-foreground`, `--secondary-foreground` | `#64646F` | `#B0B0BF` | Metadata og sekundær tekst |
| `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` | `#6C4DE6` | `#B5A3FF` | Primær handling og fokus |
| `--primary-foreground`, `--sidebar-primary-foreground` | `#FFFFFF` | `#201A36` | Tekst på primary |
| `--accent`, `--sidebar-accent` | `#EEE9FF` | `#302841` | Valgt navigation og valgt række |
| `--accent-foreground`, `--sidebar-accent-foreground` | `#5838BC` | `#D8CCFF` | Tekst på valgt element |
| `--sidebar-background` | `#F4F4F2` | `#18181E` | Fast navigation |
| `--sidebar-foreground` | `#454550` | `#CECED8` | Navigationens tekst |
| `--border`, `--sidebar-border` | `#E2E2E0` | `#393942` | Dekorative opdelinger |
| `--input` | `#858590` | `#777783` | Control-kant, hvor kanten er nødvendig for at finde feltet |
| `--destructive` | `#B42318` | `#FDA29B` | Destruktiv handling |
| `--destructive-foreground` | `#FFFFFF` | `#351716` | Tekst på destruktiv handling |

Violet bruges koncentreret. En samtaleliste bliver ikke lilla, blot fordi Sona er et AI-produkt. Hover er neutral; selection er violet; fokus er en tydelig ring. De tre tilstande skal kunne skelnes.

Dark primary skal have mørk tekst. Den eksisterende kombination af lys violet og hvid tekst må ikke kopieres ukritisk. Dekorative borders kan være svage, mens inputkanter, ikoner og fokus skal have tydelig kontrast.

### Status og AI

Status får egne semantiske token-par, eksempelvis `--status-success-bg` og `--status-success-fg`, med tilhørende Tailwind-mapping. De findes ikke endnu. Brandfarven må ikke overtage statusfarvernes betydning.

| Rolle | Light tekst / baggrund | Dark tekst / baggrund | Eksempel |
| --- | --- | --- | --- |
| Success | `#16624F` / `#E8F5EE` | `#8AD8B5` / `#19382C` | Løst, tilsluttet, gemt |
| Warning | `#83520D` / `#FFF4DA` | `#F1CE80` / `#3D3018` | Afventer godkendelse, tredjepart |
| Danger | `#B42318` / `#FEEDEC` | `#FDA29B` / `#422323` | Fejl, afbrudt handling |
| Info | `#245FA6` / `#EBF3FF` | `#A5C9FF` / `#20334E` | Kræver opmærksomhed, information |
| Neutral | `#64646F` / `#EFEFED` | `#B0B0BF` / `#282830` | Afventer kunde, inaktiv |
| AI / selection | `#5838BC` / `#EEE9FF` | `#D8CCFF` / `#302841` | Sona-udkast, valgt element |

"Afventer kunde" foreslås neutral, så violet får en stabil rolle som brand og AI. Det ændrer den nuværende statuskodning og skal gennemgås særskilt. Behold tekstlabel og ikon ved alle statusser. "Sona-udkast", "Afventer godkendelse", "Godkendt i testtilstand" og "Udført" skal visuelt og sprogligt være forskellige. Et godkendt testresultat må ikke ligne en udført ekstern handling.

Til grafer foreslås rækkefølgen violet, blå, teal, amber og rosa via `--chart-1` til `--chart-5`. Labels, stregmønstre eller markører skal også skelne dataserier. Endelige chart-værdier vælges og testes på de konkrete grafbaggrunde.

## Typografi, afstande og form

| Element | Forslag |
| --- | --- |
| Sidetitel | Inter 24/32 px, vægt 600. Inbox-header 18/24 px |
| Sektionstitel | 16/24 px, vægt 600 |
| Controls, navigation, tabeller | 14/20 px, vægt 400 eller 500 |
| Mailtekst og composer | 15/24 px. Læseområdet cirka 65 til 80 tegn pr. linje |
| Metadata og badges | 12/16 px. Undgå 10 og 11 px som normal produkttekst |
| Tal i tabeller og analytics | Tabular numbers. Tal højrejusteres |
| Afstandsskala | 4, 8, 12, 16, 24, 32, 48 px |
| Sidepadding | 24 px desktop, 16 px smalle visninger |
| Controls | 36 px høj standard, 32 px kompakt desktop, 44 px touch |
| Radius | 6 px små elementer, 8 px controls, 12 px selvstændige kort og overlays |
| Ikoner | Lucide. 16 px i controls, 20 px i selvstændige værktøjer. Samme stroke som eksisterende naboer |
| Skygger | Kort højst `0 1px 2px rgb(0 0 0 / 0.04)`. Overlays `0 8px 24px rgb(0 0 0 / 0.12)`. Dark får tydelig kant først |

Inbox-paneler deles med rette skillelinjer. Runde kort bruges til afgrænsede opgaver som en integration eller en settings-sektion. Vi pakker ikke hver besked, tabelcelle eller liste ind i endnu et kort.

## Fælles komponentregler

| Komponent | Fælles adfærd og udtryk |
| --- | --- |
| Button | Violet primary til vigtigste handling i et arbejdsområde. Sekundær er neutral outline. Ghost til værktøjer. Destructive er rød. Alle har hover, pressed, focus, disabled og loading uden breddeskift |
| Input / Select | Samme højde og radius. Synlig label, neutral baggrund, tydelig kant, violet fokus. Fejltekst ved feltet. Placeholder erstatter aldrig label |
| Tabs | Understregning til sidenavigation, segmented control til visningsvalg. Samme mønster for samme opgave på alle sider |
| Badge | Svag statusbaggrund, læsbar tekst og evt. ikon. Statiske badges skal ikke ligne knapper |
| Table / list | Fælles toolbar, filterplacering og rækkehøjder. Neutral hover, violet selection, tydelig sortering. Kompakte rækker cirka 44 px; samtalerækker cirka 68 px |
| Dialog / Sheet | Samme titel- og footerhierarki. Escape lukker, fokus bliver i overlay og vender tilbage til trigger. Brug eksisterende Radix-komponenter |
| Empty / loading / error | Tom tilstand forklarer næste handling. Skeleton følger det endelige layout. Fejl har konkret besked og retry. Et netværksproblem vises ikke som tom liste |
| Toast | Kort kvittering for gemt eller udført. Fejl, som kræver handling, bliver også stående ved det relevante element |

## Anvendelse i appen

| Område | Retning |
| --- | --- |
| App-ramme og sidebar | Varm neutral navigation, tydeligt workspace/shop, violet aktivt element. Bevar rail og foldbar navigation. Afgør senere, om søgning skal samles her |
| Inbox | Bevar kø, samtale og kundekontekst i det eksisterende split-view. Hvid læseflade, rolig kø, valgt samtale i svag violet. Composer har tydeligt afsenderfelt, udkaststatus og send-handling |
| Sona / agentaktivitet | Samme rolige flader som resten af appen. Violet på AI-label. Vis kilder, handlinger og godkendelsesstatus uden konstant pulsering eller dekorativ glow |
| Customers | Genbrug tabel, søgning, filtre og detail-sheet. Samme toolbar som knowledge. Workspace og butikskontekst skal kunne aflæses |
| Knowledge | Samme sideheader og lister. Vis kilde, opdatering og manglende viden med statuslabels. Knowledge skal fortsat have eksplicit shop-kontekst |
| Settings og integrations | Fælles globale tokens erstatter settings som særskilt farvetema. Formsektioner med 24 px indre afstand. Tydelig forskel på "Tilsluttet" og en primary-handling |
| Dashboard og analytics | Neutrale KPI-kort. Farve fortæller om dataserier eller status. Undgå at bruge grøn til alle tal uden en defineret positiv udvikling |

På smalle skærme viser inbox ét hovedområde ad gangen med tydelig tilbage-navigation. Kundekontekst åbner i sheet. Lister må ikke presse composer uden for viewport. Afprøv mindst 1440, 1280, 1024 og 390 px samt tekstzoom på 200 %. Det er review-størrelser, ikke nye hardcodede breakpoints.

## Bevægelse og tilgængelighed

- Gentagen navigation, valg af samtale og tastaturhandlinger reagerer med det samme. Ingen forsinket reveal af selve mailindholdet.
- Hover/farvefeedback cirka 120 ms. Popover og dialog cirka 180 ms med eksisterende `cubic-bezier(0.23, 1, 0.32, 1)`.
- Animer kun konkrete properties. Ingen `transition: all`. Overlays kan gå fra opacity 0 og scale 0.98. Respekter Radix-triggerens transform-origin.
- `prefers-reduced-motion` fjerner dekorative transforms og animationer. Feedback skal stadig være synlig.
- Mål mindst 4.5:1 for normal tekst og 3:1 for stor tekst efter [WCAG kontrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Test også nødvendige control-kanter og fokus mod deres faktiske nabofarver.
- Design controls med mindst 24 × 24 px mål og helst 44 × 44 px på touch. Følg [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Små ikoner kan have større klikområde.
- Alle icon-only handlinger har tilgængeligt navn. Tooltips kan forklare en genvej, men må ikke være eneste kilde til vigtig information.

## Resterende arbejde før en eventuel PR

1. Gennemgå det lokale farveforsøg og inbox-statusfarver. Se også konkrete Mobbin-skærme, når biblioteket virker igen.
2. Gennemgå den eksisterende lokale `/design-lab` med fiktive data. Previewet bruger de faktiske shared controls og samtalerækker. Composer-eksemplet er en fixture, ikke den fulde composer.
3. Globale tokens, Tailwind-mapping, shared controls og settings-arv er ændret i første forsøg. Vurdér paletten før vi udvider ændringerne.
4. Ret de fælles komponenter og app-rammen først. Gennemgå hardcodede farver i inbox og øvrige sider bagefter. Ren tokenudskiftning fanger dem ikke alle.
5. Afprøv inbox, Customers, Knowledge, settings, integrationer og analytics i dev. Dokumentér lokale før/efter-billeder, kontrast, keyboard, light/dark og smalle skærme.
6. `design-system.md` beskriver forsøgsbranchen. Markér først beslutninger som godkendte efter brugerens review. Opret da en PR. Hvis forsøget forkastes, kan denne lokale worktree/branch fjernes.

UI-arbejdet skal følge greenfield som default. Denne designopgave giver ikke mandat til at ændre V2-pipeline, action-logik, automation eller deploye til prod.

## Kontrol af udkastet

Den visuelle SVG er renderet lokalt med Quick Look og gennemgået for tekstoverlap og afskæring. XML og relative dokumentlinks er kontrolleret. Kontrast er beregnet med sRGB relativ luminans. Light primary med hvid tekst er 5.47:1, dark primary med mørk tekst er 7.64:1. Alle 12 status-tekstpar er mindst 5.07:1, og de to inputkanter er mindst 3.65:1 mod deres panelbaggrund.

Det er kontrol af forslagets farver og statiske skitse. Keyboard, responsive layout, indlæst font og faktisk komponentkontrast mangler stadig dev-verifikation ved implementering. Disse målinger gælder den oprindelige skitse. Forsøgsbranchens runtime-verifikation registreres separat med branch, revision og begrænsninger.

## Punkter til vores gennemgang

- Er varm neutral + violet den rigtige identitet, eller skal vi prøve den køligere blå retning?
- Hvor meget farve skal sidebar have? Forslaget bruger neutral baggrund og violet på aktive elementer.
- Skal "Afventer kunde" være neutral, så violet kan stå for Sona og selection?
- Føles den kompakte inbox og de mere luftige settings som samme produkt i skitsen?
- Første implementeringsrunde foreslås at være tokens, fælles controls og app-ramme. Derefter inbox med fiktive data, før vi breder ændringerne ud.
