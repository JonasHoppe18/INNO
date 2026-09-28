# Sona — agent entry

Læs [`.agents/README.md`](.agents/README.md) først, derefter **[`.agents/environments.md`](.agents/environments.md)** (dev først). Factory før kode (`/new-feature`). Design-system før UI. Merge ikke PRs uden eksplicit instruks. Skip `/greploop` indtil Greptile er sat op.

## Invarianter

- **Target:** greenfield end-to-end support-agent — default for nye features. Se `.agents/greenfield/`.
- **V2** (`generate-draft-v2` / `postmark-inbound`) er stadig live i prod; rør kun ved eksplicit V2/hotfix. Se `.agents/legacy/v2-pipeline.md`.
- **Miljø:** alt default til Supabase **`zxaoycxzdjrbnzvbullk`** og `https://dev.sona-ai.dk`. Prod (`ikuupzjaxzvatdnmyzoy`) kun ved eksplicit “prod”-instruks. Supabase MCP = dev.
- Knowledge kræver eksplicit `shop_id`.
- Workspace/org-tenancy: `user_id` er ikke nok.
- Ny action-logik: både manuelt og automatisk mode (når I rører V2/automation).
- `postmark-inbound` deployes med `--no-verify-jwt`.

Aldrig commit til `main`. Isolér i worktree/branch. Upload ikke kunde-mails eller PII til offentlige hosts.
