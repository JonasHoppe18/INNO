# Tiered inline-image sizing i trådvisningen

**Dato:** 2026-07-25
**Status:** Implementeret, ikke deployet
**Filer:** `apps/web/lib/inbox/email-html.js` (ny), `apps/web/components/inbox/MessageBubble.jsx`, `tests/inbox-email-image-sizing.test.mjs` (ny)

## Problem

Signaturlogoer fra afsendere (AceZone, noima) renderede 340px høje i trådvisningen
og skubbede den faktiske mailtekst ud af viewporten. I forward-kæder — som er
normen i AceZone-tråde via Zendesk/Outlook — ligger der 3-4 signaturer i samme
mail, så en agent skal scrolle forbi over 1000px logo for at læse beskeden.

## Rodårsag

To lag, hvor kun det ene var kendt på forhånd.

**1. `EMAIL_BODY_CLASS` cappede inline-billeder ved `max-h-[340px]`.** Det er
indholdsstørrelse, ikke signaturstørrelse.

**2. Det tidligere fix (`8f4923a`, merged 2026-07-22) var dead code i
trådvisningen.** Det bevarede afsenderens `width`-attribut som en inline style
på det genopbyggede `<img>`-tag — men det efterfølgende generiske
style-strip-pass i `sanitizeEmailHtml` fjernede netop det attribut igen når
`preserveInlineStyles` var `false`. Flaget er kun `true` i "View email"-modalen,
hvilket forklarer præcis hvorfor modalen så rigtig ud og tråden ikke gjorde.
Fixet var deployet (prod-bundle bygget 23/7) og havde aldrig virket der hvor
problemet var.

## Design

To tiers, hvor default'en er stram nok til at heuristikkens præcision ikke er
kritisk.

**Tier 1 — indholdsbilleder.** `EMAIL_BODY_CLASS` capper ved `max-h-[160px]`.
Billeder uden deklareret bredde får ingen inline sizing og falder igennem til
den cap, hvor `width:auto` bevarer aspect ratio. Billeder med deklareret bredde
beholder den og sætter `max-height:none`.

**Tier 2 — signatur-zonen.** `max-height:44px; max-width:200px; width:auto;
height:auto` som inline style, plus `data-signature-image="true"` som
diagnostisk hook. Afsenderens deklarerede bredde droppes bevidst — ensartethed
er hele pointen med denne tier.

**Detektion — kun position.** `findSignatureZoneStart()` returnerer laveste
offset af en sign-off-markør (`Med venlig hilsen`, `mvh`, `Kind regards`,
`Many thanks`, RFC 3676 `-- ` m.fl.) eller en citat-markør (`<blockquote`,
`gmail_quote`, `From:` … `Sent:`, `-----Original Message-----` m.fl.). Alt
`<img>` derfra og frem er tier 2.

Fravalgt: **filnavns-heuristik** (Outlook navngiver både logoer og indsatte
screenshots `image001.png` — for høj falsk-positiv-rate) og **bredde-heuristik**
(den eksisterende width-bevaring håndterer allerede små deklarerede bredder).

### Invarianter

**Ingen forvrængning.** Et eksplicit `width` sammen med en `max-height` klemmer
højden mens bredden står fast. Ingen tier må udsende den kombination —
håndhævet af test og verificeret i browseren (`ratioOk` på alle billeder).

**Billed-styles overlever sanitiseringen.** Genopbyggede `<img>`-tags parkeres
bag `@@SONA_IMG_<n>@@`-placeholders mens de generiske sanitize-pass kører, og
substitueres tilbage til allersidst. Det er den strukturelle rettelse af
rodårsag 2 — ikke en streng-match på den style vi selv lige har bygget.
Placeholders i afsender-indhold neutraliseres på input.

### Isolation

`sanitizeEmailHtml` + CID/attachment/style-helpers er flyttet fra
`MessageBubble.jsx` (1151 → 900 linjer) til `apps/web/lib/inbox/email-html.js`.
Rene funktioner, ingen React — logikken kunne ikke unit-testes hvor den lå.

## Fejltilstande

Begge er milde, hvilket er grunden til tiered frem for ren heuristik:

- heuristik rammer forbi → logo bliver 160px (irriterende, ikke ødelæggende)
- falsk positiv på et rigtigt foto → 44px thumbnail, stadig klikbart til lightbox

## Verifikation

16 tests i `tests/inbox-email-image-sizing.test.mjs`, inkl. en eksplicit
regressionstest for rodårsag 2. Fuld suite: 333/339 — de 6 fejl er
præeksisterende (verificeret mod baseline uden ændringerne). Lint rent,
`next build` kompilerer og typechecker (prerender fejler kun på manglende
Clerk-nøgler i worktreet).

Visuel verifikation med den rigtige sanitizer og den rigtige `EMAIL_BODY_CLASS`
på en realistisk forward-kæde:

| | Før | Efter |
|---|---|---|
| Kundefoto | 340px | 160px |
| noima-logo | 340px | 44px |
| AceZone-logo | 340px | 44px |
| Samlet trådhøjde | 1622px | 850px (−48%) |

## Ikke i scope

**Quoted content foldes ikke sammen.** `safeQuotedBodyHtml` beregnes i
`MessageBubble.jsx` men bruges aldrig i render — citeret indhold er ikke
sammenfoldeligt, og i forward-kæder falder visningen tilbage på hele `body_html`
(`shouldPreferFullBodyPreview`). Det er den underliggende grund til at der
overhovedet er flere signaturer i én visning. Et Gmail-agtigt "•••"-expander er
selvstændigt arbejde.

## Deploy

Web-only ændring. Droplet: `git pull && cd apps/web && npm run build && pm2
restart sona-web`. Ingen migration, ingen edge function.
