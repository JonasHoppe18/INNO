# Arkitektur — target og landkort

Sona er en AI-first support platform til Shopify-butikker. **Målet** er én grounded end-to-end support-agent der kan håndtere kundeservicesager med høj svarkvalitet (tools, autoritativ policy, trace, eval).

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
