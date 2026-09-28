# Prod og dev — hard gates

**Antag altid dev.** Stop og spørg før noget der rører prod (`ikuupzjaxzvatdnmyzoy`).

| | Dev (default) | Prod (kun eksplicit) |
|--|---------------|----------------------|
| App | `https://dev.sona-ai.dk` | Produktion — ikke default for agent-arbejde |
| Supabase project ref | `zxaoycxzdjrbnzvbullk` | `ikuupzjaxzvatdnmyzoy` |
| Supabase URL | `https://zxaoycxzdjrbnzvbullk.supabase.co` | `https://ikuupzjaxzvatdnmyzoy.supabase.co` |
| Web-deploy | Push til **`main`** → DigitalOcean → `dev.sona-ai.dk` | Separat, eksplicit promote |
| Supabase MCP / migrations / `functions deploy` | Kun `zxaoycxzdjrbnzvbullk` | Kun hvis brugeren skriver eksplicit at det er **prod** |

## Regler

1. Default er **dev**. Projicer aldrig `ikuupzjaxzvatdnmyzoy` ind i MCP, CLI eller scripts uden at brugeren har sagt “prod”.
2. Supabase MCP: `project_id` / `--project-ref` = `zxaoycxzdjrbnzvbullk` medmindre andet er sagt.
3. `supabase/.temp/linked-project.json` har tidligere peget på **prod**. Verificér aktivt linket projekt før CLI/MCP — antag ikke “linked = ok”.
4. Gamle `docs/superpowers/plans/` der deployer til `ikuupzjaxzvatdnmyzoy` er **forældede ift. proces**. Følg denne fil, ikke de planer.
5. **Web til dev:** DigitalOcean skal tracke branchen **`main`** (ikke `staging`). Én gang i DO App Platform → app for `dev.sona-ai.dk` → Settings → Source → Branch = `main`. Indtil det er skiftet, deployer kun pushes til den gamle branch.

## Dev-login

Samme non-prod Clerk-bruger til **`https://dev.sona-ai.dk`** og lokal `npm run dev` (localhost). Credentials ligger **ikke** i git:

- Fil: `apps/web/.env.local` (og evt. `.env.development.local`)
- Variabler: `DEV_LOGIN_EMAIL`, `DEV_LOGIN_PASSWORD`
- Skabelon: `apps/web/.env.local.example`

Agenter: læs værdierne fra `.env.local` når I skal logge ind i browser. Commit aldrig password.

## Local

```bash
cd apps/web
npm run dev     # Next.js — peg .env.local på DEV Supabase
npm run build
```

`.env.local` i `apps/web` skal pege på **dev** (`zxaoycxzdjrbnzvbullk`), ikke prod. Fælles Clerk/Supabase-hjælpere bor i `shared/`.

Edge Functions:

```bash
npx supabase functions serve <navn>
# migrations / deploy — kun med eksplicit project-ref til DEV:
npx supabase db push --project-ref zxaoycxzdjrbnzvbullk
supabase functions deploy <navn> --project-ref zxaoycxzdjrbnzvbullk
```

`postmark-inbound` deployes med `--no-verify-jwt` (også på dev, når I tester inbound).

Eval, playground og greenfield kører mod det miljø `.env` peeger på — hold det på **dev**.

Flere agenter: hver worktree egen `node_modules` og egen port. Bekræft med `lsof` at du rammer *din* proces. Worktrees isolerer **ikke** databasen hvis de deler samme Supabase-URL.

## Test-mode vs mutationer

- Manuelt: actions `pending`, venter på menneske.
- Automatisk: eksekveres hvis `agent_automation` tillader det.
- `approved_test_mode`: godkendt i produktet, **ingen** ekstern mutation.

Default er manuelt. Antag aldrig auto-execute — heller ikke på dev uden at tjekke flags.

## Verifikation før promote til prod

Alt der skal i prod skal først være gennemtestet på **dev** (`dev.sona-ai.dk` + Supabase `zxaoycxzdjrbnzvbullk`). Prod-deploy / MCP / migrations er et **separat, eksplicit** skridt efter menneskelig godkendelse.

Dokumentér i PR hvad der blev kørt på dev, og at prod endnu ikke er rørt.
