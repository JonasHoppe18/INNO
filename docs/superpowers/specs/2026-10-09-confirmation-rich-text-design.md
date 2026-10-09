# Rich text i confirmation-mailen (C) — design

Dato: 2026-10-09 · Branch: `feat/confirmation-rich-text-1009` · Status: til review
Forudsætning: B1/B2 og toolbar (#115–#117) merget.

## Formål

Butikker skal kunne formatere hele confirmation-mailen: fed skrift, farver og links. Butiksnavnet og andre variabler skal kunne bruges overalt, og designeren skal vise eksempelværdier i stedet for `{{…}}`.

Det kan ikke lade sig gøre i dag, fordi beskeden ligger i en custom-blok (`confirmation-message`), og Templatical's custom-blokke kun har almindelige tekstfelter. Variabler er desuden kun tilladt i den blok, fordi afsenderen kun indsætter beskeden ét sted (`{{content}}`) i layoutet.

**Valgt retning (A):** nye designs bygges af editorens almindelige tekst- og overskriftsblokke, og variabler tillades i dem. Afsenderen udfylder variabler i hele mailen. Designs med den gamle beskedblok sendes præcis som i dag.

**Succeskriterier:**
- En butik kan farve et ord i beskeden og sætte en footer med `{{store.name}}`. Mailen sendes med formateringen og det rigtige butiksnavn.
- Eksisterende publicerede designs sender byte-identisk som før.

## Ikke i scope

- Satisfaction-mailen. Den bruger allerede variabler i tekstblokke.
- Automatisk konvertering af gemte designs. En butik får den nye model ved at vælge en skabelon. Den gamle beskedblok virker fortsat.
- Variabler i knap-URL'er, billed-URL'er eller emne-preview-tekst.
- Nye variabler.

## To modeller side om side

| | Legacy (i dag) | Fuld design (ny) |
|---|---|---|
| Indhold | Præcis én `confirmation-message`-blok | Ingen beskedblok. Variabler i tekst- og overskriftsblokke |
| Kompileret HTML | Layout med `{{content}}` | Hele mailen med `{{token}}`-pladsholdere og markøren `<!--sona:full-design-->` |
| Tekstversion | Beskedens tekst | Udledt af HTML'en ved kompilering |
| Afsender | Indsætter beskeden i `{{content}}` | Udfylder tokens i hele HTML'en (HTML-escaped) og i tekstversionen |

Afsenderen vælger model ud fra markøren `<!--sona:full-design-->`. Det kræver ingen migration eller RPC-ændring. Gamle layouts uden `{{content}}` beholder deres nuværende opførsel, hvor indholdet tilføjes til sidst.

## Web: designer og kompilering

- **Validering (`normalizeConfirmationContent`):**
  - Højst én beskedblok (0 eller 1 i stedet for præcis 1).
  - Variabler fra `CONFIRMATION_TOKEN_MAP` (`customer.first_name`, `customer.full_name`, `store.name`, `conversation.subject`, `ticket.reference`) er tilladt i `title`- og `paragraph`-indhold. Ukendte variabler afvises som i dag.
  - Variabler i andre felter (knapper, billeder, URL'er) afvises fortsat.
- **Markører:** før rendering erstattes hver tilladt variabel af en markør, så den delte CSAT-renderer ikke rører dem. Efter rendering bliver markørerne til sender-tokens (`{{customer_first_name}}` osv.). Det er samme teknik som for `ticket.reference` i dag.
- **Kompilering uden beskedblok:** `html` = hele mailen med tokens og markøren `<!--sona:full-design-->`. `text` = HTML → tekst via en ren funktion `htmlToPlainText`:
  - blok-tags giver linjeskift
  - `<br>` giver linjeskift
  - links bliver til `tekst (url)`
  - tags fjernes, entities dekodes
  - tomme linjer samles
- **Preview, Send test og Settings-preview** bruger samme `renderCustomerConfirmation`, som får samme to-model-logik som afsenderen.
- **Designeren:**
  - Beskedblokken fjernes fra paletten. Den kan stadig vises og redigeres i gamle designs, fordi blokdefinitionen forbliver registreret.
  - Kravet "Add one required message block before publishing" fjernes.
  - Variabler i tekstblokke vises som chips med eksempelværdier (Templatical's Sample/Label-visning).
- **Skabeloner:** alle fire confirmation-skabeloner bygges af tekstblokke i stedet for beskedblokken. Indholdet er det samme: hilsen, tak, "Your ticket number: {{ticket.reference}}", svar-linjen og hilsenen med `{{store.name}}`. Afsnit bliver separate `<p>`.

## Afsender (postmark-inbound)

- `composeConfirmation` får en gren for fuldt design:
  - **HTML:** alle tokens udfyldes med HTML-escapede værdier. Kundens navn kan dermed aldrig indsætte markup.
  - **Ticket-reference:** samme regel som i dag. Uden ticket-nummer fjernes `[ ]` i emnet, og tokenet bliver tomt i HTML. Afsnit i tekstversionen, der nævner det, fjernes.
  - **Tekstversionen:** tokens udfyldes uden escaping.
  - **Emnet:** som i dag.
  - **Markøren** fjernes fra den sendte HTML.
- Legacy-grenen er uændret. Eksisterende Deno-tests skal forblive grønne.
- Den tilsvarende web-logik (`renderCustomerConfirmation`) holdes identisk og testes med de samme cases.

## Deploy

- **Dev:** postmark-inbound deployes til dev fra main efter merge (`--no-verify-jwt`), som tidligere. Derefter testes med en rigtig mail til dev-inboxen (Jonas sender).
- **Prod:** først ved eksplicit "prod". Postmark-inbound er V2 og live i prod. Rækkefølgen er afsender først, derefter web. En gammel afsender kan ikke sende fulde designs korrekt, så web må ikke publicere den nye model, før afsenderen kan.

## Test og evidens

- **Unit (web):**
  - `htmlToPlainText`: afsnit, linjeskift, links, entities, tomme linjer
  - normalisering:
    - variabler i paragraph/title tilladt
    - ukendt variabel afvist
    - variabel i knap afvist
    - 0 og 1 beskedblok ok, 2 afvist
  - kompilering uden beskedblok: tokens i HTML, markør, tekstversion
  - `renderCustomerConfirmation` fuldt design:
    - escaped navn (`<script>`)
    - farvet ord bevaret
    - footer med butiksnavn
    - ticket-reference til stede eller fraværende
  - legacy-cases uændrede
  - alle fire skabeloner kan gemmes og sender "Your ticket number: T-50001"
- **Deno:** samme fuldt-design-cases for `composeConfirmation`. Legacy-tests uændrede.
- **Chrome mod dev:**
  - vælg Branded → farv et ord → tilføj en footer med `{{store.name}}` → Preview viser formatering og "Demo Store"
  - canvas viser eksempelværdier
  - dev-kladden tages i backup og genskabes bagefter
- **Rigtig mail på dev** efter merge og deploy: publicér et fuldt design, Jonas sender en mail, og confirmation-mailen har formatering, butiksnavn og ticket-nummer.

## Leverance

Én PR (web + afsender). Ingen merge uden eksplicit instruks. Ingen prod-deploy uden eksplicit "prod".
