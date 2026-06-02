# Writer mode-split — concise vs procedure

**Dato:** 2026-06-02
**Stage:** `supabase/functions/generate-draft-v2/stages/writer.ts`
**Status:** Godkendt til implementering (v1, prompt-only)

## Problem

Drafts bliver for lange — det er det mest synlige kvalitetsproblem, og det rammer
både troubleshooting og almindelig kundeservice. Writeren er allerede tungt
instrueret i brevity, men taber alligevel.

Årsagen er ikke manglende instruktion. Writeren får én stor system-prompt **plus**
~15 stablede kontekst-blokke — inkl. knowledge-chunks på op til 2500 tegn og flere
betingede "husk at spørge om X / nævn Y"-blokke (warrantyLike, technicalRefundLike,
policyReturnLike). Med så meget materiale foran sig mønstergenkender modellen mod
"fyldig support-mail" og reciterer policy/betingelser/specs kunden ikke spurgte om.

Korthed taber altså mod mængden af input, ikke mod en for svag regel.

## Løsning (v1)

Writeren udleder ét `reply_mode` fra `plan.resolution_stage` og bygger system-prompt
+ kontekst-blokke per mode. Korthed opnås ved at **sulte concise-stien for bloat**,
ikke ved en højere regel.

### Mode-mapping

`reply_mode` udledes deterministisk fra `plan.resolution_stage`:

- **`procedure`** → `troubleshoot_first`, `initiate_warranty_repair`
  Sekventielle procedurer kunden selv udfører. Uændret adfærd.
- **`concise`** → `info_only`, `refund_or_exchange`, `cancel_order`,
  `request_evidence`, `escalate_human` (og dermed thanks/update, der altid er
  `info_only`).

### `procedure` mode — uændret

Beholder nuværende system-prompt, fulde knowledge-chunks (op til 2500 tegn), alle
trin i rækkefølge, nummereret liste. Ingen regression-risiko: koden for denne sti
skal være byte-for-byte som i dag.

### `concise` mode — slank

- **Kort system-prompt** (~15 linjer): identitet + brand, sprog, de absolutte
  faktuelle forbud (ingen uverificeret ordre, opfind aldrig fakta, ingen signatur,
  kanal-regel "kunden er her allerede", aldrig telefonnummer), og én klar concise-
  direktiv: *"Svar som en travl senior-medarbejder. Led med beslutningen / svaret /
  næste handling i 1 sætning. Højst 1-2 sætninger mere. Reciter ALDRIG policy,
  betingelser eller specs kunden ikke spurgte om. Udtræk højst ÉT relevant faktum
  fra knowledge — gengiv det aldrig ordret."*
- **Knowledge stadig hentet, men hårdt kappet** til ~600 tegn pr. chunk (mod 2500),
  med instruktion om at udtrække ét faktum, ikke recitere.
- De store betingede recitations-blokke (warrantyLike / technicalRefundLike /
  policyReturnLike-guidance i `buildInfoRequirementsBlock`) udelades i concise.
  `missing_required_fields` beholdes — request_evidence skal stadig kunne bede om
  præcis det manglende.

## Blast radius

Kun writer-stagens prompt-assembly forgrener på `reply_mode`. Planner, retriever,
internal-rules, action-decision, verifier røres ikke. Det lader eval isolere
effekten af ændringen.

## Succeskriterier (måles på eksisterende eval-harness)

Kør golden/zendesk-eval før og efter:

- Median draft-længde for **concise**-cases falder markant.
- **procedure**-cases: længde uændret, ingen tabte trin (ingen fuldstændigheds-
  regression).
- `send_ready_rate` op, `overall_10` op.
- Ingen ny faktuel miss (writeren må ikke droppe nødvendige fakta i jagten på
  korthed).

Tilføj en længde-metrik (tegn eller sætningsantal) pr. case, splittet på mode, så
før/efter kan sammenlignes.

## Fallback (ikke i v1)

Hvis concise stadig kører for lang på eval efter prompt-only-splittet: tilføj en
deterministisk over-budget rewrite — ét billigt kald der kun fyrer når et
concise-svar overskrider budgettet, og kun komprimerer concise (aldrig
procedure-trin). Bygges ikke før målingen viser at prompt-only ikke er nok.

## Ud af scope (separate spor)

- Retrieval-precision (p@1 0.50 → 0.80) — næste spor.
- Læringsdestiller (major edit → beslutningsmønster → godkendt internal rule) —
  sidste spor, efter writeren er skarp.
