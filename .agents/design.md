# Sona — designretning på den lokale branch

Retningen til lokal review er hvid baggrund, svag violet selection, neutral toolbar og Inter. Brugeren har valgt den hvide inbox-retning; det er ikke en godkendelse til push, PR eller merge.

Implementationen ligger i worktreet `.worktrees/sona-design-local-1002b` på `codex/sona-design-local-1002b`. Den ældre `sona-design-1002a` er det oprindelige forslag.

## Regler for nye og ændrede sider

Læs [design-system.md](design-system.md) før UI-arbejde. Værdierne i globals.css og tailwind.config.ts er kilden; komponenterne i components/ui ejer control-styling.

- Bevar eksisterende desktop-layout, panelbredder og workflows.
- Brug semantiske tokens i begge temaer. Tilføj ikke lokale grå, blå eller lilla paletter.
- Brug samme tekstrolle til samme formål på alle sider.
- Primær handling bruger Button default. Sekundær handling bruger outline eller ghost.
- Neutral hover må ikke ligne lilla selection.
- Behold synligt keyboard-fokus, labels og fejltekst. Fjern ikke fokus på et felt uden at dets gruppe viser fokus.
- Overlays skal arve tema og typografi fra appen.
- Mobilnavigation skal være tilgængelig. Brede tabeller må scrolles i deres egen beholder; felter og handlinger må ikke klippes.
- Ingen backend-, status-, automation- eller V2-ændringer som del af designarbejdet.

## Palette

| Rolle | Light | Dark |
| --- | --- | --- |
| Canvas og sidebar | #FFFFFF | #15151A / #18181E |
| Card og popover | #FFFFFF | #1E1E25 |
| Foreground | #25252D | #F4F4F5 |
| Primary og fokus | #6C4DE6 | #B5A3FF |
| Selection | #EEE9FF | #302841 |
| Selection-tekst | #5838BC | #D8CCFF |
| Neutral hover | #F5F5F5 | #282830 |
| Skillelinjer | #E5E5E5 | #393942 |

Status bruger success, warning, info og danger med foreground/border. Behold labels. Inboxens status-trigger er neutral ligesom assignee, More og View details; øvrige status-badges bruger de semantiske varianter.

## Typografi

Inter 4.1 indlæses lokalt, inklusive italic. Root-rem er normalt 16 px. Alle dashboard-sider og design-lab bruger samme 90 % desktop-tæthed fra 1024 px. UI-tekst og metadata holdes på faste 12 px. Mobil og marketing beholder normal tæthed.

| Rolle | Token / klasse | Desktop |
| --- | --- | --- |
| UI, tabeller og navigation | text-sm | 12 / 18 px |
| Metadata og hjælpetekst | text-xs | 12 / 16 px |
| Længere læsetekst | text-base | 14 / 20 px |
| Sidetitel | text-page-heading | 16 / 24 px |
| Sektionstitel | text-section-heading | 14 / 20 px |
| Redigerbare felter | text-input md:text-sm | 16 px mobil, 12 px desktop |

Almindelig dashboard-tekst bruger vægt 450; medium 550 og semibold 650. Dashboardets almindelige UI-tekst, inklusive inboxens toolbar, ticketliste, samtalebeskeder og composer, bruger 12 px, arvet Inter-font og almindelig vægt 450. Teksttokens bruger faste px, så kompakt spacing ikke reducerer teksten yderligere. Svar-editoren følger samtalebeskederne med linjehøjde 1.5.

Skalaen er inspireret af [Shopifys publicerede designregler](https://shopify.dev/docs/apps/design/visual-design#typography) og [Polaris-fonttokens](https://github.com/Shopify/polaris-react-archive/blob/main/polaris-tokens/src/themes/base/font.ts). Den er ikke en fuld kopi af Shopifys nyeste admin. Sonas 16 px sidetitler er en lokal beslutning.

## Begrundede undtagelser

- Tredjepartslogoer og chart-serier beholder deres egne farver.
- Tagfarver, signaturer og formateret mail/knowledge-indhold er brugerindhold.
- Light/dark-miniaturer i theme-picker viser begge temaer uafhængigt af aktivt tema.
- Marketing beholder sin eksisterende skala.
- PR80 ændrer KnowledgeCategoriesClient og SonaActivityContent. Deres lokale overrides afventer afklaring af overlap; resten af designarbejdet er isoleret fra PR80.

Den oprindelige [SVG](design/sona-direction.svg) viser en tidligere varm grå retning og er historisk reference. Den aktuelle lokale app er reviewgrundlaget.

## Review og evidens

Åbn [lokal inbox](http://localhost:3106/inbox) eller [design-lab](http://localhost:3106/design-lab). Design-lab findes kun under next dev og bruger fiktive data.

Se [local-review.md](design/local-review.md) for konkrete checks og begrænsninger. Kundenavne, mails og shop-data uploades ikke til offentlige hosts. Der oprettes først PR efter brugerens godkendelse.
