# Fuld historik-import (Del 1 af dag-ét-viden-spec'en) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Udvid Zendesk-importen fra én 200-tickets-batch til fuld-historik-import med omkostningsestimat + bekræftelse, job-baseret fremdrift og resumérbarhed — så enhver ny webshop får hele sin support-historik som few-shot-materiale fra dag ét.

**Architecture:** Den eksisterende sunde lane (`import-zendesk/route.ts`: LLM-redaktion med drop-on-failure, auto-reply-filter, DB-håndhævet dedupe på `(shop_id,source_provider,external_ticket_id)`) bevares urørt i sin kerne. Rundt om den bygges: (1) et estimat-trin (Zendesk search-count pr. status → forventet engangsomkostning, kræver `confirm:true`), (2) en jobrække i den eksisterende `knowledge_import_jobs`-tabel med jsonb-cursor `{status, page}`, (3) chunk-kørsel (~50 tickets pr. API-kald; UI'et poller og fortsætter til `completed`). Rene helpers (estimat, cursor-fremdrift) ligger i en ny lib-fil med Deno-tests.

**Tech Stack:** Next.js route handler (TS), Supabase (`knowledge_import_jobs`, `ticket_examples`), Zendesk REST API (Basic auth fra `integrations`-tabellen), OpenAI (eksisterende redaktor + embeddings), Deno-tests for rene helpers.

**Spec:** `docs/superpowers/specs/2026-07-11-history-import-and-owns-the-case-design.md` (Del 1). Del 2 (owns-the-case) har sin egen plan og implementeres FØRST.

## Global Constraints

- Redaktionsprincip UÆNDRET: fejler redaktion for en ticket, droppes den (tælles som dropped) — rå PII skrives ALDRIG. Redaktor-koden (`redactOne`/`redactPairs` i ruten) må ikke svækkes.
- Kvalitetsfilter UÆNDRET: kun tickets med rigtigt agent-svar (eksisterende `isAutoReply`-filter + >20 tegn-regel i rutens pair-bygning) — genbrug, omskriv ikke.
- Dedupe: eksisterende DB-constraint `(shop_id, source_provider, external_ticket_id)` + `upsert(..., { ignoreDuplicates: true })` er dedupe-mekanismen — gen-kørsel skal være idempotent (de eksisterende 286 AceZone-rækker bevares).
- Estimat FØR kørsel: intet job må starte uden `confirm: true` i request body; estimat-svaret skal indeholde ticket-antal og forventet omkostning i USD og DKK. (Omkostningsdisciplin — jf. spec.)
- Ingen ændring af ConnectCards-lanen (`apps/web/lib/server/knowledge-import.ts`) — dens historik-guard forbliver.
- Web-tests: rene helpers testes med Deno (`deno test --no-check --allow-env <fil>`), colocated `.test.ts` — samme mønster som `apps/web/lib/server/commerce/*.test.ts`. Route-integration verificeres manuelt (ingen route-test-infra i repoet).
- `node --check` kan ikke parse TS — verificér route-ændringer ved gennemlæsning + `deno check --no-lock` hvor muligt; fuld build sker ved deploy.
- Implementering i ISOLERET worktree fra `main` — hovedmappen har brugerens uncommittede arbejde.
- Migration køres mod prod (`ikuupzjaxzvatdnmyzoy`) via Supabase MCP `apply_migration` FØR web-deploy (v87-incident-reglen: deploy aldrig kode der afhænger af ukørt migration).

## Grounded kontraktflader (verificeret mod kode + prod-DB 2026-07-11)

- `apps/web/app/api/knowledge/import-zendesk/route.ts`: `MAX_TICKETS = 200` (linje 26); statuses-loop `for (const status of ["solved", "closed"])` med side-baseret pagination (`per_page=100`, `page++`, stop ved `!data.next_page`); creds fra `integrations`-tabellen (provider='zendesk', `config.email`, `config.domain|base_url|subdomain`, `credentials_enc` → `decodeCredentials`); auth-header `Basic base64(email/token:token)`; scope via `resolveAuthScope` + `listScopedShops`; insert-rækker har `external_ticket_id: pair.ticketId`.
- `knowledge_import_jobs` (findes i prod): `id uuid, provider text, shop_id uuid, workspace_id uuid, user_id uuid, status text, cursor jsonb, max_tickets int, batch_size int, imported_count int, skipped_count int, last_error text, created_at, updated_at`. Mangler `total_count` og `dropped_count` → Task 1-migration.
- UI-kaldere: `apps/web/components/knowledge/KnowledgePageClient.jsx` og `KnowledgeCategoriesClient.jsx` (grep "import-zendesk" dér for den eksisterende knap/handler).
- Zendesk count: `GET {baseUrl}/api/v2/search/count.json?query=type:ticket status:solved` (og `status:closed`) med samme Basic-auth — returnerer `{ count }`.

---

### Task 1: Migration — job-tællere

**Files:**
- Create: `supabase/migrations/20260711090000_import_job_counters.sql`

**Interfaces:**
- Produces: `knowledge_import_jobs.total_count int` og `knowledge_import_jobs.dropped_count int` (begge nullable).

- [ ] **Step 1: Skriv migrationen**

```sql
-- Full-history import: job-level counters for the estimate/progress UI.
alter table public.knowledge_import_jobs
  add column if not exists total_count integer;

comment on column public.knowledge_import_jobs.total_count is
  'Estimated total tickets in scope for this import job (from Zendesk search count at job creation).';

alter table public.knowledge_import_jobs
  add column if not exists dropped_count integer not null default 0;

comment on column public.knowledge_import_jobs.dropped_count is
  'Tickets dropped because PII redaction failed (never stored raw).';
```

- [ ] **Step 2: Verificér**

Run: `grep -c "add column if not exists" supabase/migrations/20260711090000_import_job_counters.sql`
Expected: `2`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260711090000_import_job_counters.sql
git commit -m "feat(db): import-job counters for full-history import"
```

> **Deploy-note:** Køres mod prod via `apply_migration` FØR web-deploy.

---

### Task 2: Rene helpers — estimat + cursor

**Files:**
- Create: `apps/web/lib/server/zendesk-import-helpers.ts`
- Test: `apps/web/lib/server/zendesk-import-helpers.test.ts`

**Interfaces:**
- Produces:
  - `estimateImportCost(input: { ticketCount: number }): { ticketCount: number; usd: number; dkk: number }` — deterministisk formel, afrundet til 2 decimaler.
  - `nextCursor(input: { statuses: string[]; cursor: { status: string; page: number } | null; pageHadFullBatch: boolean }): { status: string; page: number } | null` — `null` = importen er færdig. Start (cursor=null) → `{ status: statuses[0], page: 1 }`.

- [ ] **Step 1: Skriv de fejlende tests**

```ts
// @ts-nocheck
import { assert, assertEquals } from "jsr:@std/assert@1";
import { estimateImportCost, nextCursor } from "./zendesk-import-helpers.ts";

Deno.test("estimateImportCost scales linearly and reports both currencies", () => {
  const e1 = estimateImportCost({ ticketCount: 1000 });
  const e2 = estimateImportCost({ ticketCount: 2000 });
  assertEquals(e1.ticketCount, 1000);
  assert(e1.usd > 0 && e1.dkk > e1.usd); // DKK-tal er større end USD-tal
  assert(Math.abs(e2.usd - 2 * e1.usd) < 0.01);
  assertEquals(estimateImportCost({ ticketCount: 0 }).usd, 0);
});

Deno.test("nextCursor walks pages then statuses then finishes", () => {
  const statuses = ["solved", "closed"];
  // start
  assertEquals(nextCursor({ statuses, cursor: null, pageHadFullBatch: true }), { status: "solved", page: 1 });
  // full batch -> next page, same status
  assertEquals(
    nextCursor({ statuses, cursor: { status: "solved", page: 3 }, pageHadFullBatch: true }),
    { status: "solved", page: 4 },
  );
  // short batch -> first page of next status
  assertEquals(
    nextCursor({ statuses, cursor: { status: "solved", page: 3 }, pageHadFullBatch: false }),
    { status: "closed", page: 1 },
  );
  // short batch on last status -> done
  assertEquals(
    nextCursor({ statuses, cursor: { status: "closed", page: 9 }, pageHadFullBatch: false }),
    null,
  );
});
```

- [ ] **Step 2: Kør — verificér FAIL** (modul findes ikke): `deno test --no-check --allow-env apps/web/lib/server/zendesk-import-helpers.test.ts`

- [ ] **Step 3: Implementér**

```ts
// Pure helpers for the full-history Zendesk import. No I/O.

// One-time cost model per ticket (July 2026 list prices):
// - redaction: gpt-4o-mini, ~700 input + ~500 output tokens
//   ($0.15/1M in, $0.60/1M out) => ~$0.000405/ticket
// - embedding: text-embedding-3-small, ~400 tokens ($0.02/1M) => ~$0.000008
const USD_PER_TICKET = 0.000405 + 0.000008;
const DKK_PER_USD = 7.0; // coarse — this is an ESTIMATE shown pre-run, not billing

export function estimateImportCost(input: { ticketCount: number }): {
  ticketCount: number;
  usd: number;
  dkk: number;
} {
  const n = Math.max(0, Math.floor(Number(input?.ticketCount ?? 0)));
  const usd = Math.round(n * USD_PER_TICKET * 100) / 100;
  const dkk = Math.round(usd * DKK_PER_USD * 100) / 100;
  return { ticketCount: n, usd, dkk };
}

export function nextCursor(input: {
  statuses: string[];
  cursor: { status: string; page: number } | null;
  pageHadFullBatch: boolean;
}): { status: string; page: number } | null {
  const statuses = input?.statuses ?? [];
  if (!statuses.length) return null;
  if (!input?.cursor) return { status: statuses[0], page: 1 };
  const { status, page } = input.cursor;
  if (input.pageHadFullBatch) return { status, page: page + 1 };
  const idx = statuses.indexOf(status);
  if (idx === -1 || idx === statuses.length - 1) return null;
  return { status: statuses[idx + 1], page: 1 };
}
```

- [ ] **Step 4: Kør — verificér PASS** (samme kommando). Expected: 2/2.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/zendesk-import-helpers.ts apps/web/lib/server/zendesk-import-helpers.test.ts
git commit -m "feat(import): pure cost-estimate + cursor helpers for full-history import"
```

---

### Task 3: Route — estimat-mode + job-baseret chunk-kørsel

**Files:**
- Modify: `apps/web/app/api/knowledge/import-zendesk/route.ts`

**Interfaces:**
- Consumes: `estimateImportCost`, `nextCursor` (Task 2); `knowledge_import_jobs`-kolonner inkl. Task 1's `total_count`/`dropped_count`.
- Produces: POST-kontrakt med tre modes:
  - `{ mode: "estimate" }` → `{ estimate: { ticketCount, usd, dkk } }` (ingen skrivning)
  - `{ mode: "start", confirm: true }` → opretter jobrække (status "running", cursor null, total_count fra estimat), kører FØRSTE chunk, returnerer `{ job: {...} }`
  - `{ mode: "continue", jobId }` → kører næste chunk på et running job, returnerer `{ job: {...} }` (status "completed" når cursor er null)
  - Uden `mode` → uændret legacy-adfærd (200-batch) så eksisterende UI ikke knækker før Task 4.

- [ ] **Step 1: Refaktorér ticket-hentning til én chunk-funktion**

Udtræk rutens eksisterende fetch-loop til en intern funktion (i samme fil — ruten er allerede stor, men splittes ikke i denne omgang):

```ts
const CHUNK_TICKETS = 50;
const IMPORT_STATUSES = ["solved", "closed"];

async function fetchTicketChunk(opts: {
  baseUrl: string;
  authorization: string;
  cursor: { status: string; page: number };
}): Promise<{ tickets: any[]; pageHadFullBatch: boolean }> {
  const ticketsPerPage = 100;
  const res = await fetch(
    `${opts.baseUrl}/api/v2/tickets.json?status=${opts.cursor.status}&sort_by=created_at&sort_order=desc&per_page=${ticketsPerPage}&page=${opts.cursor.page}`,
    { headers: { Authorization: opts.authorization, "Content-Type": "application/json" }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Zendesk tickets fetch failed: ${res.status}`);
  const data = await res.json().catch(() => ({ tickets: [] }));
  const batch = Array.isArray(data.tickets) ? data.tickets : [];
  return { tickets: batch, pageHadFullBatch: Boolean(data.next_page) && batch.length === ticketsPerPage };
}
```

Genbrug den eksisterende pair-bygning/redaktion/embedding/upsert VERBATIM på chunk'ens tickets (samme kode som i dag, blot fodret med chunk'en i stedet for den 200-cappede liste). `MAX_TICKETS`-cappen gælder KUN legacy-mode.

- [ ] **Step 2: Estimat-mode**

Efter creds er resolvet (genbrug eksisterende auth/integration-opslag), før legacy-flowet:

```ts
  const body = await req.json().catch(() => ({}));
  const mode = String(body?.mode || "").trim();

  if (mode === "estimate") {
    let total = 0;
    for (const status of IMPORT_STATUSES) {
      const res = await fetch(
        `${baseUrl}/api/v2/search/count.json?query=${encodeURIComponent(`type:ticket status:${status}`)}`,
        { headers: { Authorization: authorization }, cache: "no-store" },
      );
      if (!res.ok) return NextResponse.json({ error: `Zendesk count failed: ${res.status}` }, { status: 502 });
      const data = await res.json().catch(() => ({ count: 0 }));
      total += Number(data?.count ?? 0);
    }
    return NextResponse.json({ estimate: estimateImportCost({ ticketCount: total }) });
  }
```

(NB: ruten læser i dag ikke request body — verificér og flyt `req.json()` så den kun læses én gang.)

- [ ] **Step 3: Start/continue-modes**

```ts
  if (mode === "start" || mode === "continue") {
    if (mode === "start" && body?.confirm !== true) {
      return NextResponse.json({ error: "confirm:true required to start import" }, { status: 400 });
    }
    let job: any;
    if (mode === "start") {
      // total fra et frisk estimat (samme count-kald som estimate-mode)
      // ... (genbrug count-koden; gem som totalCount)
      const { data, error } = await supabase.from("knowledge_import_jobs").insert({
        provider: "zendesk", shop_id: shop.id,
        workspace_id: scope?.workspaceId ?? null, user_id: scope?.supabaseUserId ?? null,
        status: "running", cursor: null, batch_size: CHUNK_TICKETS,
        imported_count: 0, skipped_count: 0, dropped_count: 0, total_count: totalCount,
      }).select("*").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      job = data;
    } else {
      const { data, error } = await supabase.from("knowledge_import_jobs")
        .select("*").eq("id", String(body?.jobId || "")).eq("shop_id", shop.id).maybeSingle();
      if (error || !data) return NextResponse.json({ error: "job not found" }, { status: 404 });
      if (data.status !== "running") return NextResponse.json({ job: data });
      job = data;
    }

    const cursor = nextCursor({
      statuses: IMPORT_STATUSES,
      cursor: job.cursor ?? null,
      pageHadFullBatch: true, // ved start/continue: cursor peger på NÆSTE side at hente
    });
    // Konvention: job.cursor gemmer den side der SKAL hentes næst. null ved start.
    const effectiveCursor = job.cursor ?? { status: IMPORT_STATUSES[0], page: 1 };

    try {
      const { tickets, pageHadFullBatch } = await fetchTicketChunk({ baseUrl, authorization, cursor: effectiveCursor });
      // -> eksisterende pair-bygning (kommentar-fetch pr. ticket), isAutoReply-filter,
      //    redactPairs (droppede tælles), embedBatch, upsert m. ignoreDuplicates.
      //    imported = nye rækker; skipped = dubletter + kvalitetsfiltrerede; dropped = redaktionsfejl.
      const newCursor = nextCursor({ statuses: IMPORT_STATUSES, cursor: effectiveCursor, pageHadFullBatch });
      const done = newCursor === null;
      const { data: updated, error: updErr } = await supabase.from("knowledge_import_jobs").update({
        cursor: newCursor, status: done ? "completed" : "running",
        imported_count: job.imported_count + importedThisChunk,
        skipped_count: job.skipped_count + skippedThisChunk,
        dropped_count: (job.dropped_count ?? 0) + droppedThisChunk,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).select("*").single();
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ job: updated });
    } catch (err: any) {
      await supabase.from("knowledge_import_jobs").update({
        last_error: String(err?.message ?? err), updated_at: new Date().toISOString(),
        // status forbliver "running" — cursor er intakt, næste continue genoptager
      }).eq("id", job.id);
      return NextResponse.json({ error: String(err?.message ?? err), jobId: job.id }, { status: 502 });
    }
  }
```

Variabelnavnene `importedThisChunk`/`skippedThisChunk`/`droppedThisChunk` SKAL bindes til de faktiske tællinger fra den genbrugte pair/redaktion/upsert-kode (upsert-resultatets nye-række-tælling findes allerede i ruten ~linje 384 — genbrug den mekanik). Chunk'en behandler max `CHUNK_TICKETS` af de hentede tickets pr. kald; overskydende fra en 100-siders Zendesk-side håndteres ved at lade chunk-størrelsen styre pair-bygningen (slice tickets til `CHUNK_TICKETS`) og KUN rykke cursor når hele siden er forbrugt — simplest: sæt `ticketsPerPage = CHUNK_TICKETS` i `fetchTicketChunk` så én Zendesk-side = én chunk (50), og drop slicing.

- [ ] **Step 4: Verificér + kør helper-tests**

- Gennemlæs hele den ændrede rute top-til-bund: body læses én gang; legacy-mode (ingen `mode`) uændret; ingen svækkelse af redaktion/filter.
- `deno test --no-check --allow-env apps/web/lib/server/zendesk-import-helpers.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/knowledge/import-zendesk/route.ts
git commit -m "feat(import): estimate/confirm + resumable job-chunked full-history Zendesk import"
```

---

### Task 4: UI — estimat → bekræft → fremdrift

**Files:**
- Modify: `apps/web/components/knowledge/KnowledgePageClient.jsx` (den eksisterende import-zendesk-knap/handler — grep "import-zendesk" i filen)

**Interfaces:**
- Consumes: Task 3's POST-kontrakt (`estimate`/`start`/`continue`).

- [ ] **Step 1: Udvid handleren**

Erstat den eksisterende ét-kliks-import-handler med et tre-trins-flow i samme komponent (brug komponentens eksisterende state/toast-mønstre — læs filen først og følg dens stil):

1. Klik → `POST { mode: "estimate" }` → vis bekræftelses-dialog: "X tickets fundet. Estimeret engangsomkostning: ~Y kr (Z USD). Fortsæt?" (brug eksisterende dialog/confirm-mønster i filen; findes intet, brug den eksisterende Radix `Dialog`-primitiv fra `components/ui/`).
2. Bekræft → `POST { mode: "start", confirm: true }` → gem `job` i state.
3. Poll-løkke: så længe `job.status === "running"`, kald `POST { mode: "continue", jobId: job.id }` sekventielt (ingen timer nødvendig — hvert kald ER chunk'en) og opdatér en fremdriftslinje: `importeret {imported_count} · skippet {skipped_count} · droppet {dropped_count} af ~{total_count}`. Ved `completed`: succes-toast. Ved fejl-response: vis fejl + "Fortsæt import"-knap der genoptager med samme jobId.

- [ ] **Step 2: Verificér**

`npx next lint --file components/knowledge/KnowledgePageClient.jsx` fra `apps/web/` (eller komponent-gennemlæsning hvis lint-setup fejler i worktree uden node_modules — notér hvad der blev kørt).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/knowledge/KnowledgePageClient.jsx
git commit -m "feat(import): estimate/confirm dialog + progress for full-history import"
```

---

### Task 5: Prod-verifikation (AceZone)

- [ ] **Step 1:** Kør migration (Task 1) mod prod via `apply_migration`.
- [ ] **Step 2:** Web-deploy er BRUGERENS handling (droplet: git pull + npm build + pm2 restart) — bed om den og vent.
- [ ] **Step 3:** Efter deploy: kør estimat via UI (eller curl mod ruten med en session) — rapportér ticket-antal + estimeret pris til brugeren og få eksplicit OK FØR start (omkostningsdisciplin: dette er den reelle betalings-gate, ikke kun UI-dialogen).
- [ ] **Step 4:** Kør importen til completed. Verificér: `select count(*) from ticket_examples where shop_id='38df5fef-2a23-47f3-803e-39f2d6f1ed99';` vokser fra 286; jobrækken viser konsistente tællere; gen-kør estimat+start → ny kørsel importerer ~0 nye (idempotens).
- [ ] **Step 5:** Spot-tjek 5 tilfældige nye `ticket_examples`-rækker for PII (navne/emails/adresser skal være [redacted]-markører).

## Self-Review (udført ved planskrivning)

- **Spec-dækning:** job-model+resume (Task 3), dedupe/kvalitetsfilter genbrugt (constraints + Task 3), estimat+confirm (Task 2+3+5), redaktion uændret (constraints), UI-minimal (Task 4), idempotens+PII-verifikation (Task 5). Videns-destillering eksplicit ude af scope.
- **Placeholders:** Task 3's snippets markerer eksplicit hvor eksisterende kode genbruges verbatim og hvilke tælle-variabler der skal bindes — med præcise referencepunkter (upsert-tællingen ~linje 384). Det er verifikationsanvisninger mod kendt kode, ikke TBD'er.
- **Typekonsistens:** `estimateImportCost`/`nextCursor`-signaturer ens i Task 2-def og Task 3-brug; cursor-shape `{status,page}` konsistent; jobfelter matcher prod-skemaet + Task 1-migrationen.
