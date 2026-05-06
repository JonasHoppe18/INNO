# Sona AI — CLAUDE.md

## Hvad er Sona?
AI-first support platform til Shopify-butikker: email-ingest, AI-genererede svardrafts, strukturerede support-actions og human-in-the-loop approval-flows.
Første kunde kører stadig i test-mode mens draft-kvaliteten forbedres.

## Monorepo-struktur
```
/apps/web/          → Next.js 14.2.5 (App Router) — se apps/web/CLAUDE.md
/apps/mobile/       → Mobilapp (ikke etableret endnu)
/supabase/          → Edge Functions + schema + scripts — se supabase/CLAUDE.md
/shared/            → Delt kode (storage, supabase-klienter, clerk)
```

## Tech stack
| Lag | Teknologi |
|-----|-----------|
| Framework | Next.js 14.2.5, App Router, React 18.2 |
| Sprog | JavaScript + TypeScript (TS i tooling + Supabase functions) |
| Styling | Tailwind CSS 3.4.3, Radix UI, CVA, clsx |
| Auth | Clerk (@clerk/nextjs) |
| Database | Supabase Postgres + RLS |
| Backend functions | Supabase Edge Functions (Deno runtime) |
| AI | OpenAI API (embeddings + chat) |
| Email | Postmark (primær), Gmail/Outlook polling (sekundær) |
| E-commerce | Shopify Admin API + OAuth |

## Vigtige regler — læs inden du koder
- `generate-draft-unified` er den ene kilde til sandhed for draft + actions — ændringer her påvirker alt
- Ny action-logik skal håndtere både manuelt og automatisk mode
- Al knowledge-ingestion skal enforces med eksplicit `shop_id`
- Parser-logik i `postmark-inbound` og Gmail/Outlook pollers må ikke divergere stille
- Tenancy-model er under migration fra user-centric til workspace/org — antag ikke at user_id er tilstrækkeligt
- Commit tidligt og hyppigt med meningsfulde beskeder — actions er destruktive

## Hvad vi fokuserer på nu
Draft-kvaliteten er ikke god nok til at første kunde kan gå i produktion.
Prioritet: forbedre svar-kvalitet og bygge et eval-system der måler det objektivt mod rigtige tickets fra kunden.

## Kendte svagheder
- Tenancy-migration er ikke komplet — workspace-scoping kan være inkonsistent
- Gmail/Outlook parser-kvalitet matcher muligvis ikke Postmark-stien
- Policy eksisterer to steder (pinned shops-felter + agent_knowledge chunks) — pinned har forrang
- Email-quoting fra Zendesk-wrappers kan forurene parsed indhold

## Kritiske ting at vide

**OpenAI model:** Sættes via OPENAI_MODEL env var. Default er gpt-4o

**V2 pipeline:** V2 orchestrator med staged rollout via feature flags (V2_STAGED_ORCHESTRATOR_ENABLED m.fl.) — alle default false. Legacy path kører i produktion.

**Routing pre-classification:** `classifyInboundRouting` kører FØR AI-pipelinen og kan short-circuite hele flowet. Non-support emails forwardes direkte uden at ramme generate-draft-unified.

**Action types:** UI understøtter langt flere actions end dokumenteret (exchange, return, shipping method, hold fulfillment osv.)

## Seneste ændringer
- callOpenAI max_tokens hævet til 1800 (fix — kun callOpenAIWithImages var opdateret første gang)
- isTrivialTicket bruger nu orders + matchedSubjectNumber (ikke threadId som er upålidelig)
- case_state fejl logger nu til reasoningLogs (synlig i UI)

## Deploy
Postmark-inbound skal altid deployes med `--no-verify-jwt`
