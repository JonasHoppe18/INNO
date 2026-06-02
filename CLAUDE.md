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
- `generate-draft-v2` er den aktive pipeline — `postmark-inbound` kalder kun denne. `generate-draft-unified` er legacy og bruges ikke i produktion
- Ny action-logik skal håndtere både manuelt og automatisk mode
- Al knowledge-ingestion skal enforces med eksplicit `shop_id`
- Parser-logik i `postmark-inbound` og Gmail/Outlook pollers må ikke divergere stille
- Tenancy-model er under migration fra user-centric til workspace/org — antag ikke at user_id er tilstrækkeligt
- Commit tidligt og hyppigt med meningsfulde beskeder — actions er destruktive

## Hvad vi fokuserer på nu
Eval-systemet er bygget og kørende. Prioritet er nu at bruge eval-resultaterne aktivt til at forbedre draft-kvaliteten og få første kunde i produktion.

## Kendte svagheder
- Tenancy-migration er ikke komplet — workspace-scoping kan være inkonsistent
- Gmail/Outlook parser-kvalitet matcher muligvis ikke Postmark-stien
- Policy hentes nu KUN fra agent_knowledge (retrieval); pinned policy leverer kun adfærds-guardrails, ikke data. Recall på den rigtige policy-chunk er nu den kritiske faktor (måles via eval)
- Email-quoting fra Zendesk-wrappers kan forurene parsed indhold

## Kritiske ting at vide

**OpenAI model:** Sættes via OPENAI_MODEL env var. Default er gpt-4o

**V2 pipeline:** `generate-draft-v2` er aktiv produktion — kaldt direkte fra `postmark-inbound`. `generate-draft-unified` er legacy og er ikke i brug.

**Routing pre-classification:** `classifyInboundRouting` kører FØR AI-pipelinen og kan short-circuite hele flowet. Non-support emails forwardes direkte uden at ramme generate-draft-unified.

**Action types:** UI understøtter langt flere actions end dokumenteret (exchange, return, shipping method, hold fulfillment osv.)

## Seneste ændringer
- **Conversation-aware case-state:** `case-state-updater` labeler nu roller via `from_me` (ikke et ikke-eksisterende `direction`-felt — den gamle check var død, så agent-forpligtelser blev aldrig udvundet i produktion). Læser desuden `quoted_body_text`, så tidligere agent-svar der kun lever i citat-blokken (fx AceZone der svarer via Zendesk uden `from_me=true` rows) bliver fanget til `decisions_made`/`pending_asks`.
- **Leak-fri eval-harness:** `/api/eval/zendesk-tickets` ankrer nu ground-truth på det SIDSTE agent-svar i stedet for det første. Historik er strengt forudgående kontekst (ingen future-turn leak) — multi-turn tickets bliver ægte warm follow-up cases.
- **Snippet-matcher precision-lag:** LLM-baseret precision/abstention på retrieval (threshold/margin/budget) for at vælge KUN den rigtige knowledge-chunk og afstå når intet matcher.
- **Retriever-coherence + golden-eval:** `retriever-coherence` stage + `golden-eval`/`gold-labels` tooling (`supabase/scripts/run-golden-eval.mjs`, `build-gold-labels.mjs`, `probe-recall.mjs`, `supabase/eval/gold-labels.acezone.json`) til at måle retrieval-kvalitet mod AceZone-labels. Design-docs i `docs/superpowers/`.
- Eval-system bygget: `eval_runs` tabel, EvalPanel UI, worker-baseret kørsel via `/api/eval/run`
- Knowledge kategorier tilføjet (`knowledge_categories` tabel + UI)
- Draft edit-statistik: `/api/threads/[id]/draft-stats` tracker redigeringer inden send
- Analytics dashboard tilføjet (TicketVolumeChart, overview API)
- Fine-tuning pipeline tilføjet (FineTuningPanel + `/api/fine-tuning`)
- `shop_action_config` tabel tilføjet — per-shop konfiguration af action-typer
- Knowledge gaps + snippets API tilføjet til at identificere og udfylde huller

## Deploy
Postmark-inbound skal altid deployes med `--no-verify-jwt`
