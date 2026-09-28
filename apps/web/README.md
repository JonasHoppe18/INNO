# INNO webapp

Next.js-baseret web-ui med Tailwind + Shadcn/TailArk, Clerk-login.

## Kom i gang

1. `npm install` i repo-roden.
2. Kopiér `.env.local.example` til `.env.local` — peg på **dev** Supabase (se `.agents/environments.md`).
3. Start: `npm run web`
4. Production build: `npm run web:build && npm run web:start`

## Miljøvariabler

| Navn | Beskrivelse |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Server-side Clerk |
| `NEXT_PUBLIC_CLERK_FRONTEND_API` | Valgfrit, custom Clerk domain |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase-projekt (dev default) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `OUTLOOK_WEBHOOK_HOST` | Offentlig base-URL til Graph webhooks (legacy) |
| `OUTLOOK_CLIENT_STATE_SECRET` | Signering af Graph `clientState` (legacy) |
| `MICROSOFT_OAUTH_PROVIDER` | Clerk provider for Outlook (default `oauth_microsoft`) |

## Tilgængelige sider

- `/dashboard` – oversigt
- `/inbox` – support-tråde (Clerk-beskyttet)
- `/settings` – indstillinger
