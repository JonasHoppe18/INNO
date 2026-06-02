# apps/web — Frontend

## Mappestruktur
```
app/
  (dashboard)/        → Dashboard-layout gruppe
  api/                → API routes
  onboarding/         → Onboarding-flow
  dashboard/          → Dashboard
components/
  inbox/              → Inbox UI (TicketDetail, InboxSplitView osv.)
  settings/           → Indstillingssider
  agent/              → AI-agent UI: AutomationPanel, EvalPanel, PlaygroundPanel, PersonaPanel
  analytics/          → Analytics UI (TicketVolumeChart osv.)
  knowledge/          → Knowledge base UI (kategorier, gaps, snippets)
  integrations/       → Shopify + mailbox integrationer
  mailboxes/          → Mailbox-konfiguration
  onboarding/         → Onboarding-komponenter
  ui/                 → Delte UI-primitiver (Radix/shadcn)
lib/
  server/             → Server-side datalogik (inbox-data.js, eval-runner.js osv.)
  inbox/              → Inbox-specifik logik
  translation/        → Oversættelsesfunktionalitet
hooks/                → React hooks
utils/                → Hjælpefunktioner
```

## Vigtige API routes
```
api/eval/run/          → Start eval-kørsel (worker-baseret)
api/eval/zendesk-tickets/ → Hent tickets til eval fra Zendesk
api/draft/preview-v2/  → Preview draft uden at gemme
api/analytics/overview/ → Analytics data til dashboard
api/knowledge/gaps/     → Identificer knowledge-gaps
api/knowledge/snippets/ → Knowledge snippets
api/threads/[id]/draft-stats/ → Draft edit-statistik (redigering inden send)
api/fine-tuning/       → Fine-tuning pipeline
```

## Kommandoer
```bash
npm run dev       # Start lokalt
npm run build     # Byg til produktion
```
