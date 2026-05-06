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
  agent/              → AI-agent UI-komponenter
  knowledge/          → Knowledge base UI
  integrations/       → Shopify + mailbox integrationer
  mailboxes/          → Mailbox-konfiguration
  onboarding/         → Onboarding-komponenter
  ui/                 → Delte UI-primitiver (Radix/shadcn)
lib/
  server/             → Server-side datalogik (inbox-data.js osv.)
  inbox/              → Inbox-specifik logik
  translation/        → Oversættelsesfunktionalitet
hooks/                → React hooks
utils/                → Hjælpefunktioner
```

## Kommandoer
```bash
npm run dev       # Start lokalt
npm run build     # Byg til produktion
```
