# supabase — Backend

## Kernetabeller
```
mail_threads          → En support-tråd (klassificering, tags, status, is_read)
mail_messages         → Individuelle beskeder i en tråd (inkl. composer-drafts som rows hvor is_draft=true, from_me=true)
mail_attachments      → Vedhæftede filer
drafts                → Analytics-tracking af drafts (status, edit_classification, edit_delta_pct) — ikke selve draft-teksten
thread_actions        → Action-forslag og deres approval/execution lifecycle
agent_logs            → Struktureret event-logging (step_detail JSON)
shops                 → Shopify-butikker + policy/tone felter
agent_automation      → Permissions og automation-flags per shop
agent_knowledge       → Embedding-backed vidensbase (chunks + metadata)
knowledge_categories  → Kategoriseret knowledge-struktur
shop_products         → Synkede Shopify-produkter
retrieval_traces      → Sporing af retrieval-resultater
shop_action_config    → Per-shop konfiguration af action-typer
mail_accounts         → Mailbox-konfiguration (bundet til shop via shop_id)
eval_runs             → Kørte eval-batches med scores og diagnostik
workspaces            → Org-niveau tenancy (under migration)
workspace_members     → Medlemmer i workspace
workspace_email_routes → Email-routing per workspace
```

## Ticket lifecycle (forstå dette før du ændrer noget)
1. Email modtages → forwardet til `<slug>@inbound.sona-ai.dk`
2. `postmark-inbound`: dedup, spam-filter, parse clean/quoted tekst, thread-matching via `In-Reply-To`/`References`
3. Skriv til `mail_threads`, `mail_messages`, `mail_attachments`
4. Klassificering + tags
5. Trigger `generate-draft-v2`
6. LLM returnerer draft + strukturerede action-forslag i ét kald
7. Deterministisk validering via `agent_automation` flags — model-forslag vs. system-tilladelse
8. Action ender i én af: `auto_executed` | `pending_approval` | `blocked` | `approved_test_mode`
9. Log til `thread_actions` + `agent_logs`
10. Svar sendes via Postmark/Gmail/Outlook
11. Inbox UI opdateres

## Actions og godkendelsesflow
AI foreslår actions — deterministisk validering afgør om de må eksekveres.

**Manuelt mode (standard):** Actions gemmes som `status: pending` og venter på medarbejdergodkendelse.

**Automatisk mode:** Actions eksekveres direkte. Aktiveres bevidst af kunden i indstillinger.

**Test mode:** `approved_test_mode` — action godkendes men muterer ikke eksternt system.

**Vigtig regel:** Tjek altid `agent_automation` flags før eksekvering. Default er altid manuelt.

## Draft-storage — TRE steder (kend forskellen!)

Drafts findes faktisk tre steder. Alle tre er nødvendige og må ikke konsolideres uden grund.

1. **`mail_messages.ai_draft_text` på inbound rows (`from_me=false`)**
   AI'ets forslag fra pipelinen (`generate-draft-v2`). Skrives når pipelinen genererer et nyt forslag, ryddes når brugeren sender eller pipelinen erstatter med en ny version. Aldrig vist direkte — kun læst af UI for at injicere som start-værdi i composeren.

2. **`mail_messages` rows hvor `is_draft=true, from_me=true`**
   Composer-drafts — det brugeren faktisk har skrevet/redigeret i UI'et. Auto-saved hver 4. sek. Der må kun være ÉN per tråd (enforced af unique index `uniq_active_composer_draft_per_thread`).

3. **`drafts` tabel (legacy analytics)**
   Sporing af draft-livscyklus: `status` (pending|sent|superseded), `kind`, `execution_state`, `edit_classification`, `edit_delta_pct`. Heavily brugt af analytics, dashboard, fine-tuning, send-route og insights. **Ikke** kilden til selve draft-teksten — den ligger i (1) og (2). Skal ALTID skrives med `workspace_id` sat (NULL workspace_id er en tenant-leak-vektor).

**Vigtige regler ved draft-arbejde:**
- Brug ALTID `.eq("thread_id", threadId)` — aldrig `.in("thread_id", [provider_thread_id, threadId])`. Gmail genbruger `provider_thread_id` på tværs af urelaterede konversationer, så IN-querier læker drafts mellem tråde.
- Den kanoniske skrive-flow for composer-drafts: se `apps/web/app/api/threads/[threadId]/draft/route.js` linjer 399-427.

## Åbne tenancy-risici (under workspace-migration)

- **RLS er IKKE aktiv på `mail_messages` og `mail_threads`** — tenancy enforcement sker udelukkende i app-laget via `applyScope`/`resolveAuthScope` (`apps/web/lib/server/workspace-auth.js`). Hvis et endpoint glemmer scope-kald, læker data.
- `apps/web/hooks/useInboxData.js` querier direkte mod `mail_threads`/`mail_messages` med en user-level Clerk-klient (ikke service_role). RLS-aktivering kræver derfor enten policies designet til den klients JWT, eller en refaktor der flytter de queries til API-routes (service_role bypasser RLS).
- Den planlagte RLS-rollout er skubbet til en dedikeret session. Indtil da: vær EKSTRA påpasselig med scope i alle nye queries mod mail-tabeller.

## Knowledge og retrieval
- Primær kilde: `agent_knowledge` tabel (chunks + embeddings, scopet på `shop_id`)
- Policy/tone hentes deterministisk via `buildPinnedPolicyContext` fra `shops`-felter
- `shopify_policy` chunks filtreres fra generisk retrieval da pinned policy har forrang
- **Scoping-regel:** Al knowledge er altid scopet til eksplicit `shop_id` — aldrig implicit scope

## Kommandoer
```bash
npx supabase functions serve <navn>   # Test Edge Function lokalt
npx supabase db push                  # Push migrations
supabase functions deploy postmark-inbound --no-verify-jwt
```
