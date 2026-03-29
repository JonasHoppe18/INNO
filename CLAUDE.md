# Sona AI — CLAUDE.md

## Hvad er Sona?
Sona er et AI-first support platform til Shopify-butikker, optimeret til:
- Ingest af support-emails og thread-håndtering
- AI-genererede svardrafts af høj kvalitet
- Forslag til og eksekvering af strukturerede support-actions
- Human-in-the-loop approval-flows hvor nødvendigt

Første kunde er onboardet men kører stadig i test-mode mens draft-kvaliteten forbedres.

## Monorepo-struktur
```
/apps/web/                          → Next.js 14.2.5 (App Router)
  app/                              → App Router pages
    (dashboard)/                    → Dashboard-layout gruppe
    api/                            → API routes
    onboarding/                     → Onboarding-flow
    dashboard/                      → Dashboard
  components/
    inbox/                          → Inbox UI (TicketDetail, InboxSplitView osv.)
    settings/                       → Indstillingssider
    agent/                          → AI-agent UI-komponenter
    knowledge/                      → Knowledge base UI
    integrations/                   → Shopify + mailbox integrationer
    mailboxes/                      → Mailbox-konfiguration
    onboarding/                     → Onboarding-komponenter
    ui/                             → Delte UI-primitiver (Radix/shadcn)
  lib/
    server/                         → Server-side datalogik (inbox-data.js osv.)
    inbox/                          → Inbox-specifik logik
    translation/                    → Oversættelsesfunktionalitet
  hooks/                            → React hooks
  utils/                            → Hjælpefunktioner

/apps/mobile/                       → Mobilapp (ikke etableret endnu)

/supabase/
  functions/
    postmark-inbound/               → Primær inbound email-handler
    generate-draft-unified/         → AI draft + action proposal (ét LLM-kald)
      workflows/                    → Workflow-specifik logik
    shopify-start/                  → Shopify OAuth start
    shopify-callback/               → Shopify OAuth callback
    shopify-connect/                → Shopify forbindelses-logik
    shopify-orders/                 → Ordre-sync
    shopify-order-update/           → Ordre-opdateringer
    shopify-status/                 → Shopify status-tjek
    clerk-webhook/                  → Clerk auth webhooks
    gmail-list/                     → Gmail polling (sekundær inbound)
    outlook-list/                   → Outlook polling (sekundær inbound)
    imap-poll/                      → IMAP polling
    persona-test/                   → AI persona-testfunktion
    _shared/                        → Delt kode på tværs af functions
      tracking/                     → Event tracking
  schema/                           → Database schema
  scripts/                          → DB-hjælpescripts

/shared/                            → Delt kode på tværs af apps
  storage/                          → Storage-hjælpere
  supabase/                         → Delte Supabase-klienter/typer
  clerk/                            → Delte Clerk-hjælpere
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
| AI | OpenAI API (embeddings + chat) — fra både web og Supabase functions |
| Email | Postmark (primær), Gmail/Outlook polling (sekundær) |
| E-commerce | Shopify Admin API + OAuth |

## Kernetabeller
```
mail_threads          → En support-tråd (klassificering, tags, status, is_read)
mail_messages         → Individuelle beskeder i en tråd
mail_attachments      → Vedhæftede filer
drafts                → AI-genererede svardrafts
thread_actions        → Action-forslag og deres approval/execution lifecycle
agent_logs            → Struktureret event-logging (step_detail JSON)
shops                 → Shopify-butikker + policy/tone felter
agent_automation      → Permissions og automation-flags per shop
agent_knowledge       → Embedding-backed vidensbase (chunks + metadata)
shop_products         → Synkede Shopify-produkter
retrieval_traces      → Sporing af retrieval-resultater
mail_accounts         → Mailbox-konfiguration (bundet til shop via shop_id)
workspaces            → Org-niveau tenancy (under migration)
workspace_members     → Medlemmer i workspace
workspace_email_routes → Email-routing per workspace
```

## Ticket lifecycle (forstå dette før du ændrer noget)
1. Email modtages → forwardet til `<slug>@inbound.sona-ai.dk`
2. `postmark-inbound` Edge Function: dedup, spam-filter, parse clean/quoted tekst, thread-matching via `In-Reply-To`/`References`
3. Skriv til `mail_threads`, `mail_messages`, `mail_attachments`
4. Klassificering + tags
5. Trigger `generate-draft-unified`
6. LLM returnerer draft + strukturerede action-forslag i ét kald
7. Deterministisk validering via `agent_automation` flags — model-forslag vs. system-tilladelse
8. Action ender i én af: `auto_executed` | `pending_approval` | `blocked` | `approved_test_mode`
9. Log til `thread_actions` + `agent_logs`
10. Svar sendes via Postmark/Gmail/Outlook
11. Inbox UI opdateres

## Actions og godkendelsesflow
AI foreslår actions — deterministisk validering afgør om de må eksekveres.

**Manuelt mode (standard)**
Actions gemmes som `status: pending` og venter på medarbejdergodkendelse.

**Automatisk mode (kan slås til per shop)**
Actions eksekveres direkte. Aktiveres bevidst af kunden i indstillinger.

**Test mode**
`approved_test_mode` — action godkendes men muterer ikke eksternt system.

Nuværende action-typer: ændre leveringsadresse, annullere ordre, oprette refund, sende besked til kunde.

**Vigtig regel:** Tjek altid `agent_automation` flags før eksekvering. Default er altid manuelt.

## Knowledge og retrieval
- Primær kilde: `agent_knowledge` tabel (chunks + embeddings, scopet på `shop_id`)
- Policy/tone hentes deterministisk via `buildPinnedPolicyContext` fra `shops`-felter
- `shopify_policy` chunks filtreres fra generisk retrieval da pinned policy har forrang
- **Scoping-regel:** Al knowledge er altid scopet til eksplicit `shop_id` — aldrig "latest shop" eller implicit scope

## Vigtige regler — læs inden du koder
- `generate-draft-unified` er den ene kilde til sandhed for draft + actions — ændringer her påvirker alt
- Ny action-logik skal håndtere både manuelt og automatisk mode
- Al knowledge-ingestion skal enforces med eksplicit `shop_id`
- Parser-logik i `postmark-inbound` og Gmail/Outlook pollers må ikke divergere stille
- Tenancy-model er under migration fra user-centric til workspace/org — antag ikke at user_id er tilstrækkeligt
- Commit tidligt og hyppigt med meningsfulde beskeder — actions er destruktive

## Kommandoer
```bash
npm run dev              # Start lokalt
npm run build            # Byg til produktion
npx supabase functions serve <navn>  # Test Edge Function lokalt
npx supabase db push     # Push migrations
```

## Hvad vi fokuserer på nu
Draft-kvaliteten er ikke god nok til at første kunde kan gå i produktion.
Prioritet: forbedre svar-kvalitet og bygge et eval-system der måler det objektivt
mod rigtige tickets fra kunden.

## Kendte svagheder at være opmærksom på
- Tenancy-migration er ikke komplet — workspace-scoping kan være inkonsistent
- Gmail/Outlook parser-kvalitet matcher muligvis ikke Postmark-stien
- Policy eksisterer to steder (pinned shops-felter + agent_knowledge chunks) — pinned har forrang
- Email-quoting fra Zendesk-wrappers kan forurene parsed indhold

## Kritiske ting at vide

**OpenAI model:** Sættes via OPENAI_MODEL env var. Default er gpt-4o-mini 
hvilket er utilstrækkeligt til produktionskvalitet. Skal være gpt-4o.

**V2 pipeline:** Der eksisterer en V2 orchestrator med staged rollout via 
feature flags (V2_STAGED_ORCHESTRATOR_ENABLED m.fl.) — alle default false. 
Legacy path kører i produktion. V2 indeholder case-assessment, reply-strategy 
og action-decision moduler som ikke er aktive endnu.

**Routing pre-classification:** classifyInboundRouting kører FØR 
AI-pipelinen og kan short-circuite hele flowet. Non-support emails 
forwardes direkte uden at ramme generate-draft-unified.

**Action types:** UI understøtter langt flere actions end dokumenteret 
(exchange, return, shipping method, hold fulfillment osv.)

## Seneste ædnringer:
- callOpenAI max_tokens hævet til 1800 (fix — kun callOpenAIWithImages 
  var opdateret første gang)
- isTrivialTicket bruger nu orders + matchedSubjectNumber 
  (ikke threadId som er upålidelig)
- case_state fejl logger nu til reasoningLogs (synlig i UI)


## Husk altid at deploy supabase 
Postmark-inbound skal altid deployes med --no-verify-jwt
