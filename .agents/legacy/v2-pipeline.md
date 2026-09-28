# Legacy: V2 production pipeline

> **Ikke target.** Den nye retning er greenfield ([../greenfield/](../greenfield/)). Denne fil beskriver den **nuværende** live sti i prod indtil cutover. Rør kun når opgaven er V2/hotfix.

Læs [../environments.md](../environments.md) først. Default arbejde og MCP er **dev** — ikke prod.

## Invarianter (V2)

- `generate-draft-v2` er den aktive draft-pipeline i prod. `postmark-inbound` og eval kalder den.
- Ny inbound-logik wires kun ind i `postmark-inbound`. `gmail-list` / `outlook-list` er legacy og må ikke udvides.
- Al knowledge-ingestion kræver eksplicit `shop_id`.
- Tenancy migrerer fra user til workspace/org. `user_id` er ikke tilstrækkeligt.
- Ny action-logik skal håndtere både manuelt og automatisk mode.
- OpenAI-model: `OPENAI_MODEL`, default `gpt-4o`.

## Flow

```
Kunde-mail → <slug>@inbound.sona-ai.dk
  → postmark-inbound (dedup, spam, parse, thread-match)
  → mail_threads / mail_messages / mail_attachments
  → classifyInboundRouting (kan short-circuite non-support)
  → generate-draft-v2 (draft + strukturerede actions i ét kald)
  → draft_generations trace (append/update pr. pipeline-run)
  → deterministisk validering via agent_automation
  → thread_actions + agent_logs
  → inbox UI; send via Postmark når en agent godkender/sender
```

Action-udfald: `auto_executed` | `pending_approval` | `blocked` | `approved_test_mode`. Default er manuelt (`pending`). Test mode muterer ikke eksterne systemer. Tjek altid `agent_automation` før eksekvering.

UI understøtter flere action-typer end docs typisk nævner (exchange, return, shipping method, hold fulfillment, osv.).

## Routing og policy

`classifyInboundRouting` (`supabase/functions/_shared/email-routing-classifier.ts`) kører **før** AI-pipelinen. Non-support forwardes uden draft.

Policy til writeren kommer fra `agent_knowledge` (`usable_as: policy`) via retrieval. `buildPinnedPolicyContext` er kun adfærds-guardrails, ikke policy-data. Recall på den rigtige chunk er kritisk (måles via eval).

Kendte svagheder: workspace-scoping kan være inkonsistent; Zendesk-quoting kan forurene parsed indhold.

## Kernetabeller (V2 / delt schema)

```
mail_threads             support-tråd (klassificering, tags, status, is_read)
mail_messages            beskeder (composer-drafts: is_draft=true, from_me=true)
mail_attachments         vedhæftninger
drafts                   analytics på draft-livscyklus — ikke selve teksten
draft_generations        observability-trace pr. generate-draft-v2-run
thread_actions           action-forslag og approval/execution
agent_logs               struktureret event-log
shops                    Shopify-butikker + policy/tone
agent_automation         permissions og automation-flags per shop
agent_knowledge          embeddings, scoped på shop_id
knowledge_categories     kategorier
shop_products            synkede produkter
retrieval_traces         retrieval-spor
shop_action_config       per-shop action-typer
mail_accounts            mailbox (via shop_id)
eval_runs                LLM-judge eval-batches
gold_eval_cases/runs/…   håndkureret draft-kvalitets-eval (adskilt fra eval_runs)
workspaces               org-tenancy (under migration)
workspace_members
workspace_email_routes
```

`draft_generations` erstatter ikke `drafts` / `agent_logs` / `retrieval_traces`. Dyb reference (arkiv): `docs/archive/draft-generation-observability.md`. Gold-eval detaljer (arkiv): `docs/archive/gold-eval-foundation.md`. Runner: `apps/web/lib/server/gold-eval-runner.js`.

Schema er rodet under workspace-migration. Cleanup og nye tabeller kun på **dev** — se [../environments.md](../environments.md).

## Draft-storage (tre steder — konsolider ikke)

1. `mail_messages.ai_draft_text` på inbound (`from_me=false`) — pipeline-forslag. Injiceres i composer, vises ikke som egen row.
2. `mail_messages` med `is_draft=true, from_me=true` — composer. Auto-save ~4s. Én aktiv per tråd (`uniq_active_composer_draft_per_thread`).
3. Tabel `drafts` — analytics (`status`, `edit_classification`, …). Altid `workspace_id` (NULL er tenant-leak).

Queries: altid `.eq("thread_id", threadId)` — aldrig `.in` med `provider_thread_id`. Composer-skrivestien: `apps/web/app/api/threads/[threadId]/draft/route.js`.

## Tenancy

RLS er **ikke** aktiv på `mail_messages` og `mail_threads`. Scope sker i appen (`applyScope` / `resolveAuthScope` i `apps/web/lib/server/workspace-auth.js`). Glemte scope-kald lækker data. `useInboxData.js` querier med user-level Clerk-klient.

## Frontend (delt app)

```
app/(dashboard)/   dashboard-layout
app/api/           API routes
app/onboarding/    onboarding
components/inbox/  TicketDetail, InboxSplitView, …
components/settings/
components/agent/  AutomationPanel, EvalPanel, PlaygroundPanel
components/analytics/
components/knowledge/
components/integrations/
components/mailboxes/
components/csat/   CSAT email builder + response UI
components/ui/     shadcn/Radix
lib/server/        inbox-data, eval-runner, workspace-auth, …
lib/inbox/         status-model, view-model, …
```

Nyttige V2-routes: `api/eval/run`, `api/eval/zendesk-tickets`, `api/draft/preview-v2`, `api/analytics/overview`, `api/knowledge/gaps`, `api/knowledge/snippets`, `api/threads/[id]/draft-stats`, `api/fine-tuning`, CSAT under `api/settings/csat/` og `api/csat/`.

Eval: `eval_runs`, EvalPanel, worker via `/api/eval/run`. Ground-truth i zendesk-eval ankrer på **sidste** agent-svar.

CSAT feature-doc: `docs/csat-email-builder.md`.

## Status og kø

Kanonisk thread-status: `needs_attention` / `waiting_customer` / `waiting_third_party` / `resolved`. Inbound kunde → `needs_attention` (`statusOnInboundCustomerMessage` i `_shared/thread-status`, kaldt fra `postmark-inbound`). Agent-svar → waiting via `buildAgentReplyStatusPatch`. `tick_thread_lifecycle()` (pg_cron) vækker/lukker efter workspace `auto_close_mode`. UI-kompatibilitet: `toLegacyUiStatus` i `apps/web/lib/inbox/status-model.js`.

Migrations og deploy-rækkefølge (historik): `docs/superpowers/plans/2026-07-03-thread-lifecycle-status-deploy-checklist.md`. Antag ikke at alt er kørt; kør kun mod **dev** medmindre eksplicit prod.

## Historik

- Feature-specs og planer: `docs/superpowers/` — **ikke** kanonisk, og mange peget fejlagtigt på prod.
- Arkiv: `docs/archive/`.
