# Agent-kontekst for Sona

Mappen er til coding-agenter (Cursor, Claude Code, Codex). Læs i den rækkefølge opgaven kræver — ikke alle filer hver gang.

| Fil | Læs når |
|-----|---------|
| [environments.md](environments.md) | **Først** — deploy, MCP, migrations, DB, login. Dev er default |
| [factory.md](factory.md) | Ny opgave, før du skriver kode |
| [architecture.md](architecture.md) | Landkort: target vs V2, DB-rod, cutover |
| [greenfield/](greenfield/) | **Target** — ny E2E support-agent (default for nye features) |
| [legacy/v2-pipeline.md](legacy/v2-pipeline.md) | Kun V2/hotfix på den nuværende prod-sti |
| [design-system.md](design-system.md) | UI, layout, styling, nye komponenter |
| [design.md](design.md) | Forslag til kommende designretning, tokens og fælles mønstre. Udkast til gennemgang |
| [skills/](skills/) | Factory-skills (`new-feature`, `code-structure`, …) — se factory.md |

Rodfilen `AGENTS.md` er den eneste auto-indgang.

**Ikke kanonisk** (læs kun som historik): `docs/superpowers/`, `docs/archive/`. Aktiv feature-doc uden for `.agents/`: `docs/csat-email-builder.md`.

Greenfield er **target**. V2 er **legacy indtil cutover**. Bland dem ikke. Alt arbejde default til **dev**.
