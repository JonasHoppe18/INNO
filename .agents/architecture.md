# Arkitektur — target og landkort

# Visionen for Sona AI

**Visionen med Sona er at skabe en AI-kundeservicemedarbejder, der kan håndtere størstedelen af en webshops kundehenvendelser selvstændigt, korrekt og med samme kvalitet som en dygtig menneskelig medarbejder.**

Sona skal være mere end en chatbot, der besvarer spørgsmål. Den skal forstå kundens problem, huske samtalens kontekst, finde den nødvendige information og hjælpe kunden hele vejen frem til en løsning.

Sona skal kunne kombinere tre centrale ting:

1. **Webshoppens viden:** Forstå produkter, handelsbetingelser, returpolitikker, reklamationsprocedurer og interne retningslinjer.
2. **Live data:** Hente aktuelle oplysninger om ordrer, leveringer, lagerstatus, kunder og forsendelser fra eksempelvis Shopify og fragtleverandører.
3. **Handlinger:** Udføre relevante opgaver som at annullere ordrer, ændre leveringsadresser og håndtere returneringer, når det er tilladt og sikkert.

Det afgørende er, at Sona ikke bare skal have adgang til information. **Den skal vide, hvornår informationen er tilstrækkelig, hvad den må gøre, og hvordan den bedst hjælper kunden videre.** Den skal ikke stille unødvendige spørgsmål, gentage information eller give generiske svar, når problemet allerede kan løses.

Samtidig skal Sona kommunikere naturligt, personligt og professionelt. Kunden skal opleve at skrive med en kompetent kundeservicemedarbejder frem for en traditionel AI-chatbot. Hver webshop skal kunne tilpasse Sonas tone, personlighed og kommunikationsstil, så den passer til virksomhedens brand.

**Målet er, at Sona på sigt skal kunne håndtere 80–90 % eller mere af en webshops kundehenvendelser med minimal menneskelig involvering**, uden at gå på kompromis med korrekthed eller kundetilfredshed. Når Sona ikke kan løse en sag forsvarligt, skal den vide hvorfor og sørge for, at et menneske kan overtage med den nødvendige kontekst.

Sona skal være en skalerbar SaaS-platform, som webshops nemt kan tilslutte deres eksisterende systemer til og tage i brug uden omfattende teknisk opsætning.

**Den langsigtede ambition er at gøre intelligent, proaktiv og personlig kundeservice tilgængelig for enhver webshop — med en AI-medarbejder, der ikke blot svarer, men faktisk løser kundernes problemer.**

## Læs dette først

1. [environments.md](environments.md) — **dev først**, aldrig prod uden eksplicit instruks.
2. [greenfield/](greenfield/) — **target** (detaljer, principper, contracts).
3. [legacy/v2-pipeline.md](legacy/v2-pipeline.md) — kun når du rører den nuværende prod-sti.

## Target (greenfield)

Nordstjerne: én primary support-agent med model/tool-loop — ikke flere parallelle draft-pipelines.

- Kode: `apps/web/lib/greenfield-support`, `POST /api/greenfield-support`
- Docs: [greenfield/README.md](greenfield/README.md) og søskendefiler
- Principper (kort): ingen case-patches; live order/shipment via scoped tools; merchant policy er autoritativ; sensitive actions proposal-only indtil cutover tillader andet; tenancy i kode; hver nyttig run er traceable/evaluerbar

Nye features default til **greenfield** på **dev** (`dev.sona-ai.dk` / Supabase `zxaoycxzdjrbnzvbullk`).

## Nu (stadig live i prod)

Prod kører stadig V2: Postmark → `postmark-inbound` → `generate-draft-v2` → inbox/actions. Det er **legacy indtil cutover**, ikke retningen for nyt arbejde.

Rør V2 kun ved eksplicit V2/hotfix-opgave. Bland ikke greenfield og V2 “fordi det ligner”.

## Database

Schema er **rodet** (workspace-migration, overlapping draft-steder, legacy-tabeller). Cleanup og nye tabeller sker **kun på dev**. Ingen “konsolider drafts”-shortcuts uden plan. Verificér på `dev.sona-ai.dk` før noget overvejes til prod.

## Monorepo (fælles)

| Sti | Rolle |
|-----|--------|
| `apps/web/` | Next.js 14.2.5, App Router, React 18.2 |
| `supabase/` | Edge Functions (Deno), schema, scripts |
| `shared/` | Storage, Supabase-klienter, Clerk |

Stack: Tailwind, Radix, CVA, Clerk, Supabase Postgres, OpenAI, Postmark (ingest i V2), Shopify Admin API.

Fælles invariante på tværs af target og legacy:

- Knowledge / shop-data: eksplicit `shop_id`
- Tenancy: workspace/org — `user_id` er ikke nok
- Aldrig antag prod; se [environments.md](environments.md)

## Cutover

Cutover fra V2 til greenfield sker først når agenten er beviseligt bedre på **dev** (eval + manuel test på `dev.sona-ai.dk`). Indtil da: V2 forbliver live i prod; greenfield udvikles og testes på dev.

## Historik

`docs/superpowers/` og `docs/archive/` er ikke kanonisk arkitektur. Følg `.agents/`, ikke gamle planer der pegete på prod-ref.
