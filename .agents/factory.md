# Software factory

Hver opgave går gennem de samme fire slag. Skills ligger i `.agents/skills/` (symlinket til `.cursor/skills/`). Superpowers (brainstorm, plan, TDD, verification) kører **inden i** slaget, ikke i stedet for isolation.

**Læs [environments.md](environments.md) før build/ship.** Default er dev (`zxaoycxzdjrbnzvbullk` / `dev.sona-ai.dk`). Prod og Supabase-ref `ikuupzjaxzvatdnmyzoy` kun ved eksplicit instruks. MCP/migrations/functions deploy = **dev**.

| Slag | Skill | Brug |
|------|--------|------|
| Isolate | `new-feature` | Start af hver ny opgave |
| Build | `code-structure` | Når logik deles på tværs af flows — bland ikke greenfield og V2 |
| Prove | `evidence-driven-testing` | Evidens på **dev**. Video/ffmpeg valgfrit |
| Ship (UI) | `before-and-after` | Lokale screenshots. **Ingen** upload af inbox/PII til offentlige hosts |
| Ship (review) | `greploop` / `greploop-apps` | **Skip** indtil Greptile er installeret på repoet |
| Hele vejen | `unslop` | Commit/PR/docs — ikke UI-copy |

## 1. Isolate

Kør `/new-feature` (eller følg skillen) før kode:

- Aldrig byg på `main`. Aldrig commit direkte til `main`.
- Én worktree og én branch per opgave og per agent. Genbrug ikke en andens worktree, branch eller uncommitted arbejde.
- Cursor-managed worktrees (`worktree-*`): behold den tildelte worktree og branch. Manuel `git worktree add` kun hvis harnessen ikke allerede har gjort det.
- Ellers: `git fetch origin`, worktree under gitignored `.worktrees/` (eller `.claude/worktrees/`), branch fra `origin/main` (eller den base opgaven siger).
- **Scope check** før start: `gh pr list` og `gh pr diff --name-only` på overlapping PRs. Stop og spørg ved overlap.
- Worktrees isolerer **ikke** porte, lockfiles eller databaser. Bekræft at en port svarer *din* proces. Schema/MCP kun mod **dev** — se environments.md.

## 2. Build

- Hold ændringer til den tildelte opgave.
- **Default:** greenfield ([architecture.md](architecture.md), [greenfield/](greenfield/)). V2 kun ved eksplicit hotfix — [legacy/v2-pipeline.md](legacy/v2-pipeline.md).
- Brug `/code-structure` når operational logic gentages: actions/orchestring = hvorfor/hvornår; services = hvordan.
- Sne-merge ikke greenfield og `generate-draft-v2`. Split ikke V2 i flere prod-pipelines “undervejs”.
- Ny action-logik (V2/automation) skal virke i både manuelt og automatisk mode.
- Læs environments.md før tenancy/schema/deploy.

## 3. Prove

- Kør checks på **dev** (web tests, functions tests, manuel `/` på `dev.sona-ai.dk` når relevant).
- Brug `/evidence-driven-testing` når ændringen skal bevises. UI: fang before/after **lokalt**. Upload aldrig inbox, mails, shop-data eller eval-tickets til offentlige hosts.
- Pipeline/retrieval/agent: evidens er eval, golden-eval, dry-run på **dev** — ikke “det så rigtigt ud”.
- Video-recorder / ffmpeg er valgfrit. Påkrævet er verificerbar evidens, ikke prosa.

## 4. Ship

- Commit med en klar besked. Rebase på den aftalte base. Push med `-u`. Efter rebase af en allerede pushet branch: `--force-with-lease` kun på **din** task-branch. Aldrig force til `main`.
- Web til **dev**: push/merge til **`main`** → DigitalOcean deployer til `dev.sona-ai.dk` (DO skal tracke `main`, ikke `staging` — se environments.md). Det er ikke det samme som prod-promote.
- Åbn PR. Body: hvad, hvordan testet på **dev** (hvert claim med evidens), risici. Kør `/unslop` på titel/body. Merge ikke medmindre du er bedt om det.
- **Prod:** separat, eksplicit skridt efter gennemtest på dev. Ingen “bare deploy til ikuupzjaxzvatdnmyzoy”.
- **Greptile:** `/greploop` skip indtil Greptile er sat op.
- Behold worktreet indtil PR er merget eller lukket.

## Skrivning til mennesker

Kør `/unslop` på commit-beskeder, PR-titel/body og docs. Oversæt ikke UI-copy uden at det er opgaven.
