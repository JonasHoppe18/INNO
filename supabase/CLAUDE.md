# supabase — Backend

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
2. `postmark-inbound`: dedup, spam-filter, parse clean/quoted tekst, thread-matching via `In-Reply-To`/`References`
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

**Manuelt mode (standard):** Actions gemmes som `status: pending` og venter på medarbejdergodkendelse.

**Automatisk mode:** Actions eksekveres direkte. Aktiveres bevidst af kunden i indstillinger.

**Test mode:** `approved_test_mode` — action godkendes men muterer ikke eksternt system.

**Vigtig regel:** Tjek altid `agent_automation` flags før eksekvering. Default er altid manuelt.

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
