# UI-designsystem

Forslag til kommende designretning ligger i [design.md](design.md). Det er et udkast til gennemgang. Denne fil beskriver fortsat den implementerede UI.

Dokumentér det der **allerede kører** i `apps/web`. Opfind ikke ny palet, ny font eller nyt komponentbibliotek.

Kilder (sandhed for værdier): `apps/web/app/globals.css`, `apps/web/tailwind.config.ts`, `apps/web/components.json`.

## Stack

- shadcn **new-york**, `baseColor: neutral`, CSS-variabler, Lucide.
- Primitiver: `apps/web/components/ui/` (Radix + CVA + `cn`/`clsx`).
- Font: Inter, derefter system-ui (`globals.css` `:root`).
- `--radius: 0.5rem`. Tailwind `rounded-lg/md/sm` er afledt af den.

## Tokens

Brug semantiske Tailwind-klasser: `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, `bg-primary`, `bg-sidebar`, `text-sidebar-foreground`, osv. Ikke vilkårlige hex, medmindre du retter selve tokenet.

Light (`:root` i `@layer base`):

- Baggrund/kort næsten hvid; `--foreground` næsten sort.
- `--primary` default i base er nær-sort (`0 0% 9%`). Settings-skaller overskriver til violet: `.settings-theme` `--primary: 252 79% 61%`.
- `--destructive: 0 84.2% 60.2%`.
- Sidebar light: `--sidebar-background: 0 0% 98%`.

Dark (`.dark`):

- `--background: 222 14% 9%`; kort lidt lysere.
- `--primary: 246 82% 72%` (samme violet som settings dark).
- Body har svage radiale highlights — kopier ikke nye gradients ind i inbox uden grund.

Når du styler settings, forvent `.settings-theme` (violet primary, egne muted/border/sidebar-tokens). Uden for den skal: følg globale tokens.

## Komponenter

- Nye controls: eksisterende `components/ui` først, derefter samme shadcn-mønster. Ikke et tredje knap-system.
- Inbox: `InboxSplitView`, sidebar (`app-sidebar`, `nav-queue`), status-tabs, composer. Udvid mønstrene der — ikke en ny mail-klient-layout.
- Ikoner: Lucide, samme stroke/størrelse som nabokontrol.

## Motion

Eksisterende kurve: `cubic-bezier(0.23, 1, 0.32, 1)` (reveal, landing, view-enter, settings-tab). Korte UI-enter ~180–200ms. Ær `prefers-reduced-motion` (eksisterende media queries dropper transform/animation).

Ingen `transition: all`. Foretræk konkrete properties.

## Polish

Efter tokens og mønstre: projekt-skills `.claude/skills/emil-design-eng` og `.claude/skills/frontend-design`. De erstatter ikke dette skema.

## Evidens

Screenshots af UI er fine. Screenshots af rigtige kunde-mails, PII eller shops uploades ikke til offentlige hosts. Se [factory.md](factory.md).
