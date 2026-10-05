# Sona design

Dette er den valgte designretning til nye sider og ændringer i Sona. Brugeren har valgt kortvarianten af ticketlisten og godkendt push den 5. oktober 2026. Designet ligger på `codex/sona-design-local-1002b`; PR og merge er separate skridt.

Læs [design-system.md](design-system.md) for komponentregler, mål og kontrol af nye sider. Implementerede tokens i `apps/web/app/globals.css`, `apps/web/tailwind.config.ts` og `apps/web/components/ui/` er kilden til værdierne.

## Udtryk

Sona skal føles rolig, kompakt og let at scanne. Navigation og almindelige sider er hvide. Samtale og ticketliste bruger en meget svag varm grå arbejdsflade med hvide kort. Violet markerer valg, primære handlinger og AI. Status har egne semantiske farver og tydelige labels.

Bevar eksisterende workflows og panelrækkefølge. Et dashboard må have mere luft end en ticketliste; font, farver og controls følger samme regler.

## Palette

| Rolle | Token | Light | Dark |
| --- | --- | --- | --- |
| Canvas | background | #FFFFFF | #15151A |
| Sidebar | sidebar | #FFFFFF | #18181E |
| Arbejdsflade i inbox | conversation | #F8F7F5 | Følger background |
| Kort og overlays | card / popover | #FFFFFF | #1E1E25 |
| Tekst | foreground | #25252D | #F4F4F5 |
| Primær handling og fokus | primary / ring | #6C4DE6 | #B5A3FF |
| Selection | accent | #EEE9FF | #302841 |
| Selection-tekst | accent-foreground | #5838BC | #D8CCFF |
| Neutral hover | muted | #F5F5F5 | #282830 |
| Skillelinjer | border | #E5E5E5 | #393942 |

Brug tokens frem for lokale hex-værdier eller gray/blue/violet-paletter. Status bruger success, warning, info og danger med foreground/border. Hover og selection skal kunne skelnes.

## Typografi og tæthed

Inter 4.1 indlæses lokalt med normal og italic. Almindelig vægt er 450, medium 550 og semibold 650.

| Rolle | Klasse | Størrelse / linjehøjde |
| --- | --- | --- |
| Almindelig UI, tabeller, navigation og controls | text-sm | 12 / 18 px |
| Metadata og hjælpetekst | text-xs | 12 / 16 px |
| Samtale og composer | text-sm leading-[1.5] | 12 / 18 px |
| Sidetitel | text-page-heading | 16 / 24 px |
| Sektionstitel | text-section-heading | 14 / 20 px |
| Redigerbare felter | text-input md:text-sm | 16 / 20 px mobil; 12 / 18 px desktop |

Nøgletal må bruge større tekstroller. text-base er en undtagelse til længere læsetekst: 0.875rem / 1.25rem, altså 12.6 / 18 px ved kompakt desktop og 14 / 20 px ved normal tæthed. Brug text-sm til almindelig UI-copy.

Fra 1024 px deler dashboard og design-lab en root-størrelse på 90 % og --app-density: 0.9. Det skalerer rem-baseret spacing, navigation og controls. UI-tekst og headings bruger faste px og bliver ikke mindre af skaleringen. Mobil og marketing beholder normal root-størrelse.

## Valgte mønstre

- Nye almindelige sider bruger DashboardPageShell, en sidetitel, evt. hjælpetekst og handlinger i headeren. Brug eksisterende Card-, Table-, Tabs- og form-komponenter efter indholdets rolle.
- Standardknapper og felter følger shared components. Kompakte controls bruger den kompakte variant. Primær handling er Button default; sekundær er outline eller ghost.
- Settings markerer det valgte menupunkt med accentbaggrund og tekst, uden lodret streg.
- Inbox-toolbar er flad: status, assignee, More og View details deler neutral styling og synligt fokus.
- Ticketlisten har hvide kort på conversation-baggrund, 4 px luft mellem kortene, svag kant og ingen skygge. Valgt kort har accentbaggrund og svag primary-kant. Ingen avatarer eller ventetidslabels som 37d.
- Ticketkort prioriterer emne og dato øverst, afsender på anden linje og kundens seneste besked i grå nederst med status og ticketnummer til højre. Alt er 12 px. Emne er 550, ulæst emne 650; øvrig tekst 450.
- Composer er centreret, lidt smallere end samtaleområdet og lavere, når den er tom. Den vokser med teksten.
- Overlays arver font og tema. Behold keyboard-fokus, labels, fejltekst, disabled- og loading-states. Brede tabeller scrolles i deres egen beholder på mobil.

## Afgrænsning og reference

Logoer, chart-serier, brugerens tagfarver, signaturer og formateret indhold kan beholde deres egne farver. Theme-picker-miniaturer viser begge temaer. PR80-filerne KnowledgeCategoriesClient og SonaActivityContent har stadig lokale overrides, der afventer afstemning.

Shopifys [Polaris-fonttokens](https://github.com/Shopify/polaris-react-archive/blob/main/polaris-tokens/src/themes/base/font.ts) var reference for Inter og vægte; Sonas 12 px UI er et lokalt valg. Mail-opdelingen er valgt gennem review af brugerens Outlook-, Apple Mail- og konkurrent-screenshots. Den oprindelige [SVG](design/sona-direction.svg) er historik og beskriver ikke det færdige design.

Se [local-review.md](design/local-review.md) for checks og begrænsninger. Implementationen ligger i `.worktrees/sona-design-local-1002b`; `.worktrees/sona-design-1002a` er det oprindelige forslag. [Localhost](http://localhost:3106/inbox) og den dev-only [design-lab](http://localhost:3106/design-lab) er reviewflader. Kunde-mails, PII og shop-data uploades ikke til offentlige hosts.
