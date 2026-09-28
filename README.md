## For at køre web

1. Opret `.env.local` i `apps/web` (peger på **dev** Supabase — se `.agents/environments.md`).
2. Kør `npm install` i repo-roden.
3. Kør `npm run web` (eller `cd apps/web && npm run dev`).

Fælles Clerk- og Supabase-hjælpere ligger i `shared/`.

## Hvorfor Deno?

Supabase Edge Functions kører på Deno i stedet for Node.js — tæt på DB, isolerede webhooks/integrationer (Postmark, Shopify, osv.).
