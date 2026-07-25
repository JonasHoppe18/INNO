# Launch-benchmark og videnshuls-klyngning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byg et frosset 150-case launch-benchmark og et klyngelag der samler fritekst-`primary_gap` fra `eval_results` til 10-15 rangerede, typebestemte temaer, så videnshuller kan lukkes inden AceZone tager Sona i brug.

**Architecture:** Rene helpers i `apps/web/lib/server/` (ingen Supabase-/OpenAI-klient, unit-testet med fixtures) plus scripts i `supabase/scripts/` der gør al I/O — samme opdeling som `major-edit-distiller.js` / `distill-major-edits.mjs`. Klyngning sker med agglomerativ average-linkage over `text-embedding-3-small`-vektorer. Typebestemmelse verificeres mod `agent_knowledge` via `match_agent_knowledge`-RPC, så LLM'ens gæt ikke står alene.

**Tech Stack:** Node 20+ ESM (`.mjs`), `node --test`, `@supabase/supabase-js`, OpenAI embeddings + chat completions, Next.js App Router (route-udvidelse), Postgres/pgvector.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-25-launch-benchmark-gap-clustering-design.md`
- **Testkommando:** `node --test tests/` — alle nye tests ligger i `tests/*.test.mjs`
- **Rene helpers må ikke importere `@supabase/supabase-js` eller lave netværkskald.** Al I/O hører til i `supabase/scripts/*.mjs`. Dette pinnes med en test.
- **Env sources fra repo-roden:** `set -a && source apps/web/.env.local && set +a`
- **Embedding-model:** `text-embedding-3-small` — SKAL matche den model `agent_knowledge`-chunks er embeddet med, ellers er vektorsammenligning meningsløs.
- **AceZone shop_id:** `38df5fef-2a23-47f3-803e-39f2d6f1ed99` — importér som `ACEZONE_SHOP_ID` fra `supabase/scripts/lib/golden-eval-core.mjs`, hardcode aldrig.
- **Scripts er dry-run som standard.** Skrivninger kræver eksplicit `--apply`, jf. `distill-major-edits.mjs`.
- **Benchmark-størrelse:** 150 cases. Omkostningsloft ~38 kr pr. kørsel.
- **Alle brugervendte strenge og rapporttekst er på dansk.**

## To rettelser til spec'en (opdaget under planlægning)

**1. `classifyInboundRouting` er forkert værktøj til stratificering.** Spec'ens arkitekturafsnit angiver den som stratificeringsnøgle. Kildelæsning af `supabase/functions/_shared/email-routing-classifier.ts:442` viser at den besvarer *"skal denne mail viderestilles eller behandles som support"* — dens kategorier kommer fra workspace-konfigurerede `activeCategories` (faktura, spam, salg). Stratificering på den ville lægge stort set hele puljen i én bucket, `support`.

Den rigtige taksonomi findes i `supabase/functions/_shared/email-category.ts:1` — `EMAIL_CATEGORIES`, 16 kategorier (Tracking, Return, Exchange, Product question, Technical support, Payment, Cancellation, Refund, Address change, Wrong item, Missing item, Complaint, Fraud / dispute, Warranty, Gift card, General). Planen bruger denne.

Modulet er Deno-TS og kan ikke importeres fra et Node-script. Taksonomien spejles derfor som konstant i den nye JS-helper, og Task 5 pinner spejlingen med en test der læser TS-filen og fejler ved drift.

**2. `probe-recall.mjs` kan ikke bruges som KB-eksistens-probe.** Spec'ens risikoafsnit henviser til den. Kildelæsning viser at den måler *retrieval-recall mod gold-labels* — den er bundet til `supabase/eval/golden-set.acezone.json` og `gold-labels.acezone.json` og besvarer "fandt matcheren den chunk vi havde labelet", ikke "findes dette indhold overhovedet i basen".

Planen bruger i stedet `match_agent_knowledge(query_embedding, match_count, filter_shop_id)`-RPC'en direkte (Task 4). Det er en ægte eksistens-check og præcis den vektorsøgning retrieveren selv bruger.

---

## File Structure

**Opret:**
- `apps/web/lib/server/gap-clusterer.js` — rene klynge-helpers: input-tekst, cosinus, agglomerativ klyngning, støjpartitionering, navngivnings-prompt/parse, typebestemmelse, rangering, rapport-rendering
- `apps/web/lib/server/benchmark-sampler.js` — rene sampler-helpers: kategori-taksonomi, kategoriserings-prompt/parse, stratificeret udvælgelse
- `apps/web/lib/server/eval-noise-filter.js` — ren helper: `isNoiseSubject`, emne-støjfilter til harvesten
- `supabase/scripts/cluster-eval-gaps.mjs` — I/O: læser `eval_results`, embedder, klynger, prober KB, skriver rapport
- `supabase/scripts/build-launch-benchmark.mjs` — I/O: harvester tickets, kategoriserer, sampler, fryser til `gold_eval_cases`
- `tests/gap-clusterer.test.mjs`
- `tests/benchmark-sampler.test.mjs`
- `tests/zendesk-noise-filter.test.mjs`

**Modificér:**
- `apps/web/app/api/eval/zendesk-tickets/route.js` — støjfilter, paginering, tidsinterval, parallelle comments-kald

---

### Task 1: Klynge-primitiver

**Files:**
- Create: `apps/web/lib/server/gap-clusterer.js`
- Test: `tests/gap-clusterer.test.mjs`

**Interfaces:**
- Consumes: intet (første task)
- Produces:
  - `buildClusterInputText(row) -> string`
  - `cosineSimilarity(a: number[], b: number[]) -> number`
  - `agglomerativeCluster(vectors: number[][], threshold: number) -> number[][]` (arrays af indices, sorteret faldende efter størrelse)
  - `partitionHarnessNoise(rows) -> { signal: row[], noise: row[] }`

- [ ] **Step 1: Write the failing test**

Opret `tests/gap-clusterer.test.mjs`:

```javascript
// Run with: node --test tests/
//
// Launch-benchmark klyngelag: rene primitiver. Ingen I/O, ingen netværk.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildClusterInputText,
  cosineSimilarity,
  agglomerativeCluster,
  partitionHarnessNoise,
} from "../apps/web/lib/server/gap-clusterer.js";

test("buildClusterInputText samler gap og missing_for_10", () => {
  const text = buildClusterInputText({
    primary_gap: "missing info about backorders",
    missing_for_10: "burde have nævnt forventet restock-dato",
  });
  assert.equal(
    text,
    "missing info about backorders. burde have nævnt forventet restock-dato",
  );
});

test("buildClusterInputText taaler manglende felter", () => {
  assert.equal(buildClusterInputText({ primary_gap: "kun gap" }), "kun gap");
  assert.equal(buildClusterInputText({ missing_for_10: "kun missing" }), "kun missing");
  assert.equal(buildClusterInputText({}), "");
  assert.equal(buildClusterInputText({ primary_gap: null, missing_for_10: null }), "");
});

test("cosineSimilarity er 1 for identiske og 0 for ortogonale vektorer", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity returnerer 0 for nulvektor i stedet for NaN", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

test("agglomerativeCluster samler naere vektorer og adskiller fjerne", () => {
  const vectors = [
    [1, 0],
    [0.99, 0.01],
    [0, 1],
  ];
  const clusters = agglomerativeCluster(vectors, 0.5);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0], [0, 1]);
  assert.deepEqual(clusters[1], [2]);
});

test("agglomerativeCluster med taerskel 0 fletter alt til een klynge", () => {
  const clusters = agglomerativeCluster([[1, 0], [0.99, 0.01], [0, 1]], 0);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0], [0, 1, 2]);
});

test("agglomerativeCluster med taerskel over max similaritet fletter intet", () => {
  const clusters = agglomerativeCluster([[1, 0], [0, 1], [0, -1]], 1.01);
  assert.equal(clusters.length, 3);
});

test("agglomerativeCluster sorterer stoerste klynge foerst", () => {
  const vectors = [
    [0, 1],
    [1, 0],
    [0.99, 0.01],
    [0.98, 0.02],
  ];
  const clusters = agglomerativeCluster(vectors, 0.5);
  assert.equal(clusters[0].length, 3);
  assert.deepEqual(clusters[0], [1, 2, 3]);
});

test("agglomerativeCluster haandterer tom liste", () => {
  assert.deepEqual(agglomerativeCluster([], 0.5), []);
});

test("partitionHarnessNoise skiller eval_harness fra signalet", () => {
  const rows = [
    { id: "a", likely_root_cause: "facts" },
    { id: "b", likely_root_cause: "eval_harness" },
    { id: "c", likely_root_cause: "intent" },
    { id: "d", likely_root_cause: null },
  ];
  const { signal, noise } = partitionHarnessNoise(rows);
  assert.deepEqual(signal.map((r) => r.id), ["a", "c", "d"]);
  assert.deepEqual(noise.map((r) => r.id), ["b"]);
});

test("partitionHarnessNoise frasorterer ogsaa excluded_from_aggregate", () => {
  const rows = [
    { id: "a", likely_root_cause: "facts", excluded_from_aggregate: true },
    { id: "b", likely_root_cause: "facts", excluded_from_aggregate: false },
  ];
  const { signal, noise } = partitionHarnessNoise(rows);
  assert.deepEqual(signal.map((r) => r.id), ["b"]);
  assert.deepEqual(noise.map((r) => r.id), ["a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: FAIL med `Cannot find module '.../gap-clusterer.js'`

- [ ] **Step 3: Write minimal implementation**

Opret `apps/web/lib/server/gap-clusterer.js`:

```javascript
// Launch-benchmark klyngelag: rene helpers.
//
// Ingen Supabase-klient og intet netværk her — supabase/scripts/cluster-eval-gaps.mjs
// gør al I/O. Disse funktioner bygger klynge-input, klynger vektorer, bygger og
// parser navngivnings-prompten, afgør klyngetype og renderer rapporten.

// Rodårsager dommeren selv flager som målestøj. Ekskluderes fra klyngning,
// men tælles og rapporteres — jf. spec'ens risikoafsnit.
const HARNESS_ROOT_CAUSES = new Set(["eval_harness"]);

export function buildClusterInputText(row = {}) {
  const gap = String(row.primary_gap ?? "").trim();
  const missing = String(row.missing_for_10 ?? "").trim();
  return [gap, missing].filter(Boolean).join(". ");
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Average-linkage agglomerativ klyngning. Vi bruger IKKE k-means: antallet af
// temaer er ukendt på forhånd og skal falde ud af data, ikke sættes som parameter.
// Fletter gentagne gange det par klynger med højest gennemsnitlig similaritet,
// indtil ingen par er over tærsklen.
export function agglomerativeCluster(vectors, threshold) {
  if (!Array.isArray(vectors) || vectors.length === 0) return [];
  let clusters = vectors.map((_, i) => [i]);

  const avgSimilarity = (ca, cb) => {
    let sum = 0;
    for (const i of ca) {
      for (const j of cb) sum += cosineSimilarity(vectors[i], vectors[j]);
    }
    return sum / (ca.length * cb.length);
  };

  for (;;) {
    let bestSim = -Infinity;
    let bestPair = null;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const sim = avgSimilarity(clusters[i], clusters[j]);
        if (sim > bestSim) {
          bestSim = sim;
          bestPair = [i, j];
        }
      }
    }
    if (!bestPair || bestSim < threshold) break;
    const [i, j] = bestPair;
    const merged = [...clusters[i], ...clusters[j]].sort((a, b) => a - b);
    clusters = clusters.filter((_, idx) => idx !== i && idx !== j);
    clusters.push(merged);
  }

  return clusters.sort((a, b) => b.length - a.length || a[0] - b[0]);
}

export function partitionHarnessNoise(rows = []) {
  const signal = [];
  const noise = [];
  for (const row of rows) {
    const isHarness = HARNESS_ROOT_CAUSES.has(String(row?.likely_root_cause ?? ""));
    const isExcluded = row?.excluded_from_aggregate === true;
    if (isHarness || isExcluded) noise.push(row);
    else signal.push(row);
  }
  return { signal, noise };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/gap-clusterer.js tests/gap-clusterer.test.mjs
git commit -m "feat(eval): add gap-clusterer primitives for launch benchmark"
```

---

### Task 2: Navngivning og typebestemmelse

**Files:**
- Modify: `apps/web/lib/server/gap-clusterer.js`
- Test: `tests/gap-clusterer.test.mjs`

**Interfaces:**
- Consumes: `partitionHarnessNoise`, `buildClusterInputText` fra Task 1
- Produces:
  - `CLUSTER_TYPES: Set<string>` — `"knowledge_gap" | "retrieval_miss" | "intent_miss"`
  - `buildClusterNamingPrompt({ rows }) -> { system: string, user: string }`
  - `parseClusterNamingResponse(jsonText) -> { theme, missing, proposed_knowledge, type }`
  - `resolveClusterType({ llmType, kbHits }) -> { type: string, reclassified: boolean, reason: string }`

- [ ] **Step 1: Write the failing test**

Tilføj til `tests/gap-clusterer.test.mjs`:

```javascript
import {
  CLUSTER_TYPES,
  buildClusterNamingPrompt,
  parseClusterNamingResponse,
  resolveClusterType,
} from "../apps/web/lib/server/gap-clusterer.js";

test("CLUSTER_TYPES indeholder praecis de tre typer", () => {
  assert.deepEqual([...CLUSTER_TYPES].sort(), [
    "intent_miss",
    "knowledge_gap",
    "retrieval_miss",
  ]);
});

test("buildClusterNamingPrompt medtager alle gap-tekster og forbyder citater", () => {
  const { system, user } = buildClusterNamingPrompt({
    rows: [
      { primary_gap: "missing backorder info", missing_for_10: "restock-dato" },
      { primary_gap: "missing stock information", missing_for_10: "lagerstatus" },
    ],
  });
  assert.match(system, /knowledge_gap/);
  assert.match(system, /retrieval_miss/);
  assert.match(system, /intent_miss/);
  assert.match(system, /ALDRIG/);
  assert.match(user, /missing backorder info/);
  assert.match(user, /missing stock information/);
});

test("parseClusterNamingResponse validerer type mod enum", () => {
  const parsed = parseClusterNamingResponse(
    JSON.stringify({
      theme: "Restock-datoer mangler",
      missing: "Forventet restock-dato pr. produkt",
      proposed_knowledge: "Restock: oplys forventet uge.",
      type: "knowledge_gap",
    }),
  );
  assert.equal(parsed.theme, "Restock-datoer mangler");
  assert.equal(parsed.type, "knowledge_gap");
});

test("parseClusterNamingResponse afviser ukendt type", () => {
  assert.throws(
    () =>
      parseClusterNamingResponse(
        JSON.stringify({ theme: "t", missing: "m", proposed_knowledge: "p", type: "vaerre" }),
      ),
    /unknown cluster type/,
  );
});

test("parseClusterNamingResponse afviser tomt theme", () => {
  assert.throws(
    () =>
      parseClusterNamingResponse(
        JSON.stringify({ theme: "  ", missing: "m", proposed_knowledge: "p", type: "intent_miss" }),
      ),
    /empty theme/,
  );
});

// --- typebestemmelse: designets vigtigste mekanisme ------------------------

test("resolveClusterType omklassificerer videnshul til retrieval-miss naar KB har indholdet", () => {
  const out = resolveClusterType({ llmType: "knowledge_gap", kbHits: 3 });
  assert.equal(out.type, "retrieval_miss");
  assert.equal(out.reclassified, true);
  assert.match(out.reason, /findes i agent_knowledge/);
});

test("resolveClusterType beholder videnshul naar KB er tom", () => {
  const out = resolveClusterType({ llmType: "knowledge_gap", kbHits: 0 });
  assert.equal(out.type, "knowledge_gap");
  assert.equal(out.reclassified, false);
});

test("resolveClusterType roerer ikke intent_miss uanset KB-hits", () => {
  const out = resolveClusterType({ llmType: "intent_miss", kbHits: 5 });
  assert.equal(out.type, "intent_miss");
  assert.equal(out.reclassified, false);
});

test("resolveClusterType roerer ikke retrieval_miss", () => {
  const out = resolveClusterType({ llmType: "retrieval_miss", kbHits: 0 });
  assert.equal(out.type, "retrieval_miss");
  assert.equal(out.reclassified, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: FAIL med `SyntaxError: The requested module ... does not provide an export named 'CLUSTER_TYPES'`

- [ ] **Step 3: Write minimal implementation**

Tilføj til `apps/web/lib/server/gap-clusterer.js`:

```javascript
export const CLUSTER_TYPES = new Set([
  "knowledge_gap",
  "retrieval_miss",
  "intent_miss",
]);

export function buildClusterNamingPrompt({ rows = [] } = {}) {
  const system = [
    "Du analyserer en klynge af kvalitetshuller fra en AI-supportpipeline på tværs af vilkårlige webshops. Antag ingen shop-specifik proces.",
    "Klyngen indeholder korte beskrivelser af hvad et AI-udkast manglede i forhold til en supportmedarbejders faktiske svar.",
    "Navngiv temaet og beskriv præcist hvad der mangler.",
    `Vælg type som præcis én af: ${[...CLUSTER_TYPES].join(", ")}.`,
    "- knowledge_gap: informationen findes ikke i shoppens vidensbase og skal skrives.",
    "- retrieval_miss: informationen findes formentlig, men blev ikke fundet.",
    "- intent_miss: pipelinen misforstod hvad kunden spurgte om.",
    'Svar KUN med JSON på formen {"theme": ..., "missing": ..., "proposed_knowledge": ..., "type": ...}.',
    "theme: kort dansk overskrift, max 60 tegn.",
    "missing: 1-2 sætninger på dansk om hvad der konkret mangler.",
    "proposed_knowledge: udkast til den knowledge-tekst der ville lukke hullet. Læg de afgørende linjer FØRST — concise-mode capper chunks ved 600 tegn. Max 500 tegn.",
    "Parafrasér: citér ALDRIG kundetekst ordret, og medtag ingen navne, emails eller ordrenumre.",
  ].join("\n");

  const user = rows
    .map((row, i) => `${i + 1}. ${buildClusterInputText(row)}`)
    .join("\n");

  return { system, user };
}

export function parseClusterNamingResponse(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!CLUSTER_TYPES.has(parsed.type)) {
    throw new Error(`unknown cluster type: ${parsed.type}`);
  }
  const theme = String(parsed.theme ?? "").trim();
  if (!theme) throw new Error("empty theme");
  return {
    theme,
    missing: String(parsed.missing ?? "").trim(),
    proposed_knowledge: String(parsed.proposed_knowledge ?? "").trim(),
    type: parsed.type,
  };
}

// Typebestemmelsen må ikke stole på LLM'ens ord alene: hvis LLM'en kalder noget
// et videnshul, men indholdet FINDES i agent_knowledge, er det i virkeligheden et
// retrieval-miss. Uden dette skridt skrives viden der allerede står i basen.
export function resolveClusterType({ llmType, kbHits = 0 }) {
  if (llmType === "knowledge_gap" && kbHits > 0) {
    return {
      type: "retrieval_miss",
      reclassified: true,
      reason: `omklassificeret: ${kbHits} matchende chunk(s) findes i agent_knowledge`,
    };
  }
  return { type: llmType, reclassified: false, reason: "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: PASS — 19 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/gap-clusterer.js tests/gap-clusterer.test.mjs
git commit -m "feat(eval): add cluster naming and KB-verified type resolution"
```

---

### Task 3: Rangering, rapport og renhedsgaranti

**Files:**
- Modify: `apps/web/lib/server/gap-clusterer.js`
- Test: `tests/gap-clusterer.test.mjs`

**Interfaces:**
- Consumes: `CLUSTER_TYPES` fra Task 2
- Produces:
  - `rankClusters(clusters) -> cluster[]` (faldende efter `caseCount`)
  - `renderClusterReport({ clusters, noiseCount, totalCount, threshold }) -> string` (markdown)
  - `meetsAcceptanceCriterion({ clusters, totalCount }) -> { ok: boolean, coverage: number, namedClusters: number }`

- [ ] **Step 1: Write the failing test**

Tilføj til `tests/gap-clusterer.test.mjs`:

```javascript
import { readFileSync } from "node:fs";
import {
  rankClusters,
  renderClusterReport,
  meetsAcceptanceCriterion,
} from "../apps/web/lib/server/gap-clusterer.js";

const CLUSTER_FIXTURE = [
  {
    theme: "Restock-datoer mangler",
    missing: "Forventet restock-dato pr. produkt.",
    proposed_knowledge: "Restock: oplys forventet uge.",
    type: "knowledge_gap",
    reclassified: false,
    caseCount: 5,
    exampleTicketIds: [101, 102],
  },
  {
    theme: "Driver-opdatering",
    missing: "Trin til driver-opdatering.",
    proposed_knowledge: "Driver: hent fra supportsiden.",
    type: "retrieval_miss",
    reclassified: true,
    caseCount: 9,
    exampleTicketIds: [201],
  },
];

test("rankClusters sorterer faldende efter caseCount", () => {
  const ranked = rankClusters(CLUSTER_FIXTURE);
  assert.deepEqual(ranked.map((c) => c.caseCount), [9, 5]);
});

test("renderClusterReport viser tema, type, antal og eksempel-tickets", () => {
  const md = renderClusterReport({
    clusters: rankClusters(CLUSTER_FIXTURE),
    noiseCount: 3,
    totalCount: 20,
    threshold: 0.82,
  });
  assert.match(md, /Driver-opdatering/);
  assert.match(md, /retrieval_miss/);
  assert.match(md, /knowledge_gap/);
  assert.match(md, /101/);
  assert.match(md, /0\.82/);
});

test("renderClusterReport rapporterer eksplicit hvor meget stoej der er lagt til side", () => {
  const md = renderClusterReport({
    clusters: CLUSTER_FIXTURE,
    noiseCount: 3,
    totalCount: 20,
    threshold: 0.8,
  });
  assert.match(md, /3 af 20/);
});

test("renderClusterReport markerer omklassificerede klynger", () => {
  const md = renderClusterReport({
    clusters: CLUSTER_FIXTURE,
    noiseCount: 0,
    totalCount: 20,
    threshold: 0.8,
  });
  assert.match(md, /omklassificeret/i);
});

test("meetsAcceptanceCriterion kraever 60 pct daekning i klynger med mindst 3 medlemmer", () => {
  const ok = meetsAcceptanceCriterion({
    clusters: [{ caseCount: 9 }, { caseCount: 5 }, { caseCount: 2 }],
    totalCount: 20,
  });
  assert.equal(ok.namedClusters, 2);
  assert.equal(ok.coverage, 0.7);
  assert.equal(ok.ok, true);
});

test("meetsAcceptanceCriterion fejler naar for mange cases staar alene", () => {
  const bad = meetsAcceptanceCriterion({
    clusters: [{ caseCount: 3 }, { caseCount: 1 }, { caseCount: 1 }],
    totalCount: 20,
  });
  assert.equal(bad.coverage, 0.15);
  assert.equal(bad.ok, false);
});

test("meetsAcceptanceCriterion haandterer totalCount 0 uden at dividere med nul", () => {
  const out = meetsAcceptanceCriterion({ clusters: [], totalCount: 0 });
  assert.equal(out.coverage, 0);
  assert.equal(out.ok, false);
});

// --- renhedsgaranti -------------------------------------------------------

test("gap-clusterer importerer hverken supabase eller laver netvaerkskald", () => {
  const src = readFileSync(
    new URL("../apps/web/lib/server/gap-clusterer.js", import.meta.url),
    "utf8",
  );
  assert.equal(/@supabase\/supabase-js/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: FAIL med `does not provide an export named 'rankClusters'`

- [ ] **Step 3: Write minimal implementation**

Tilføj til `apps/web/lib/server/gap-clusterer.js`:

```javascript
// En klynge tæller som "navngiven" i acceptkriteriet ved mindst dette antal medlemmer.
const MIN_NAMED_CLUSTER_SIZE = 3;
const ACCEPTANCE_COVERAGE = 0.6;

export function rankClusters(clusters = []) {
  return [...clusters].sort((a, b) => (b.caseCount ?? 0) - (a.caseCount ?? 0));
}

export function meetsAcceptanceCriterion({ clusters = [], totalCount = 0 } = {}) {
  const named = clusters.filter((c) => (c.caseCount ?? 0) >= MIN_NAMED_CLUSTER_SIZE);
  const covered = named.reduce((sum, c) => sum + (c.caseCount ?? 0), 0);
  const coverage = totalCount > 0 ? covered / totalCount : 0;
  return {
    ok: coverage >= ACCEPTANCE_COVERAGE && named.length > 0,
    coverage,
    namedClusters: named.length,
  };
}

export function renderClusterReport({
  clusters = [],
  noiseCount = 0,
  totalCount = 0,
  threshold = 0,
} = {}) {
  const lines = [
    "# Klyngerapport — videnshuller før lancering",
    "",
    `**Cases i alt:** ${totalCount}`,
    `**Lagt til side som målestøj:** ${noiseCount} af ${totalCount} (\`eval_harness\` eller \`excluded_from_aggregate\`)`,
    `**Afstandstærskel:** ${threshold}`,
    "",
    "| # | Tema | Type | Cases | Eksempel-tickets |",
    "|---|---|---|---|---|",
  ];

  clusters.forEach((c, i) => {
    const flag = c.reclassified ? " (omklassificeret)" : "";
    const examples = (c.exampleTicketIds ?? []).join(", ");
    lines.push(
      `| ${i + 1} | ${c.theme} | \`${c.type}\`${flag} | ${c.caseCount} | ${examples} |`,
    );
  });

  lines.push("");
  clusters.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.theme}`);
    lines.push("");
    lines.push(`**Type:** \`${c.type}\`${c.reclassified ? ` — ${c.reason}` : ""}`);
    lines.push(`**Cases:** ${c.caseCount}`);
    lines.push("");
    lines.push(`**Hvad mangler:** ${c.missing}`);
    lines.push("");
    if (c.type === "knowledge_gap" && c.proposed_knowledge) {
      lines.push("**Udkast til knowledge-tekst:**");
      lines.push("");
      lines.push("> " + c.proposed_knowledge.replace(/\n/g, "\n> "));
      lines.push("");
    }
  });

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/gap-clusterer.test.mjs`
Expected: PASS — 27 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/gap-clusterer.js tests/gap-clusterer.test.mjs
git commit -m "feat(eval): add cluster ranking, markdown report and acceptance gate"
```

---

### Task 4: Klynge-scriptet og pilotkørslen — GATE

**Files:**
- Create: `supabase/scripts/cluster-eval-gaps.mjs`

**Interfaces:**
- Consumes: alle exports fra `gap-clusterer.js` (Task 1-3), `ACEZONE_SHOP_ID` fra `supabase/scripts/lib/golden-eval-core.mjs`
- Produces: markdown-rapport på stdout eller til `--out <sti>`; exit-kode 1 hvis acceptkriteriet ikke er nået

**Denne task ender i en menneskelig beslutning.** Kør pilot på de 25 eksisterende cases fra 22/7 — det koster intet i eval, data ligger allerede i `eval_results`. Gå ikke videre til Task 5 før acceptkriteriet er nået.

- [ ] **Step 1: Skriv scriptet**

Opret `supabase/scripts/cluster-eval-gaps.mjs`:

```javascript
// supabase/scripts/cluster-eval-gaps.mjs
//
// Launch-benchmark klyngelag: læser eval_results, embedder hver cases
// primary_gap + missing_for_10, klynger dem agglomerativt, navngiver hver klynge
// med en LLM, og VERIFICERER videnshuls-klassifikationen mod agent_knowledge via
// match_agent_knowledge-RPC'en. Rapporten skrives som markdown.
//
// Al I/O ligger her; apps/web/lib/server/gap-clusterer.js er ren.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/cluster-eval-gaps.mjs --run-label "test d. 22 juli"
//   node supabase/scripts/cluster-eval-gaps.mjs --run-label "..." --threshold 0.84 --out /tmp/rapport.md
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ACEZONE_SHOP_ID } from "./lib/golden-eval-core.mjs";
import {
  buildClusterInputText,
  agglomerativeCluster,
  partitionHarnessNoise,
  buildClusterNamingPrompt,
  parseClusterNamingResponse,
  resolveClusterType,
  rankClusters,
  renderClusterReport,
  meetsAcceptanceCriterion,
} from "../../apps/web/lib/server/gap-clusterer.js";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const runLabel = argValue("--run-label", null);
const threshold = Number(argValue("--threshold", "0.82"));
const outPath = argValue("--out", null);
// Antal KB-chunks der skal returneres for at en klynge tæller som "findes i basen".
const kbMatchCount = Number(argValue("--kb-match-count", "3"));
// Similaritetsgulv for at et KB-hit tæller. Under dette er chunken irrelevant.
const kbMinSimilarity = Number(argValue("--kb-min-similarity", "0.35"));

if (!runLabel) {
  console.error("cluster-eval-gaps: --run-label er påkrævet");
  process.exit(2);
}
if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
  console.error("cluster-eval-gaps: --threshold skal være mellem 0 og 1");
  process.exit(2);
}

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error(
    "cluster-eval-gaps: mangler env — source apps/web/.env.local først",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const chatModel = process.env.OPENAI_MODEL || "gpt-4o";
// SKAL matche modellen agent_knowledge er embeddet med.
const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

async function embed(text) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: embeddingModel, input: String(text).slice(0, 8000) }),
  });
  if (!resp.ok) throw new Error(`Embedding error: ${resp.status}`);
  const data = await resp.json();
  return data.data[0].embedding;
}

async function chatJson({ system, user }) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: chatModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Chat error: ${resp.status}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

// --- 1. hent cases ---------------------------------------------------------

const { data: allRows, error } = await supabase
  .from("eval_results")
  .select(
    "id, zendesk_ticket_id, primary_gap, missing_for_10, likely_root_cause, excluded_from_aggregate",
  )
  .eq("run_label", runLabel);

if (error) {
  console.error("cluster-eval-gaps: kunne ikke hente eval_results:", error.message);
  process.exit(1);
}

const withText = (allRows || []).filter((r) => buildClusterInputText(r).length > 0);
const { signal, noise } = partitionHarnessNoise(withText);

console.error(
  `cluster-eval-gaps: ${allRows.length} rækker, ${withText.length} med gap-tekst, ${signal.length} signal, ${noise.length} støj`,
);

if (signal.length === 0) {
  console.error("cluster-eval-gaps: ingen cases at klynge");
  process.exit(1);
}

// --- 2. embed og klynge ----------------------------------------------------

const vectors = [];
for (const row of signal) {
  vectors.push(await embed(buildClusterInputText(row)));
}
const indexClusters = agglomerativeCluster(vectors, threshold);
console.error(`cluster-eval-gaps: ${indexClusters.length} klynger ved tærskel ${threshold}`);

// --- 3. navngiv, KB-probe, typebestem --------------------------------------

const clusters = [];
for (const indices of indexClusters) {
  const rows = indices.map((i) => signal[i]);
  const naming = parseClusterNamingResponse(await chatJson(buildClusterNamingPrompt({ rows })));

  // KB-eksistens-probe: findes indholdet allerede i basen? Vi bruger PRÆCIS den
  // vektorsøgning retrieveren selv bruger, så svaret afspejler hvad pipelinen
  // kan nå — ikke bare hvad der ligger i tabellen.
  let kbHits = 0;
  if (naming.type === "knowledge_gap") {
    const probeVector = await embed(`${naming.theme}. ${naming.missing}`);
    const { data: matches, error: rpcError } = await supabase.rpc("match_agent_knowledge", {
      query_embedding: probeVector,
      match_count: kbMatchCount,
      filter_shop_id: ACEZONE_SHOP_ID,
    });
    if (rpcError) {
      console.error(`cluster-eval-gaps: KB-probe fejlede for "${naming.theme}":`, rpcError.message);
      process.exit(1);
    }
    kbHits = (matches || []).filter((m) => Number(m.similarity ?? 0) >= kbMinSimilarity).length;
  }

  const resolved = resolveClusterType({ llmType: naming.type, kbHits });
  clusters.push({
    ...naming,
    ...resolved,
    caseCount: rows.length,
    exampleTicketIds: rows.slice(0, 3).map((r) => r.zendesk_ticket_id).filter(Boolean),
  });
}

// --- 4. rapport og acceptgate ----------------------------------------------

const ranked = rankClusters(clusters);
const report = renderClusterReport({
  clusters: ranked,
  noiseCount: noise.length,
  totalCount: withText.length,
  threshold,
});

if (outPath) {
  writeFileSync(outPath, report, "utf8");
  console.error(`cluster-eval-gaps: rapport skrevet til ${outPath}`);
} else {
  console.log(report);
}

const acceptance = meetsAcceptanceCriterion({ clusters: ranked, totalCount: signal.length });
console.error(
  `cluster-eval-gaps: dækning ${(acceptance.coverage * 100).toFixed(0)}% i ${acceptance.namedClusters} klynger med >=3 medlemmer`,
);
if (!acceptance.ok) {
  console.error(
    "cluster-eval-gaps: ACCEPTKRITERIE IKKE NÅET (kræver >=60%). Justér --threshold, eller skift klynge-input til reasoning-feltet før den fulde kørsel.",
  );
  process.exit(1);
}
console.error("cluster-eval-gaps: acceptkriterie nået");
```

- [ ] **Step 2: Kør piloten på eksisterende data**

```bash
set -a && source apps/web/.env.local && set +a
node supabase/scripts/cluster-eval-gaps.mjs \
  --run-label "test d. 22 juli" \
  --out /tmp/pilot-rapport.md
```

Expected: stderr viser rækkeantal, klyngeantal og dækningsprocent. Rapport i `/tmp/pilot-rapport.md`.

- [ ] **Step 3: Kalibrér afstandstærsklen**

Acceptkriteriet er ≥60% af signal-cases i klynger med ≥3 medlemmer. Med 25 cases svarer det til 4-6 klynger. Kalibrér efter dét, ikke efter et ønsket antal på 150.

Prøv `--threshold 0.78`, `0.82`, `0.86` og vælg den laveste tærskel hvor klyngerne stadig er *semantisk sammenhængende* når du læser rapporten. For lav tærskel giver én stor meningsløs klynge; for høj giver lutter enere.

```bash
for t in 0.78 0.82 0.86; do
  echo "--- threshold $t ---"
  node supabase/scripts/cluster-eval-gaps.mjs --run-label "test d. 22 juli" --threshold $t --out /tmp/pilot-$t.md
done
```

- [ ] **Step 4: GATE — læs rapporten og beslut**

Læs `/tmp/pilot-<bedste>.md` igennem. Gå kun videre hvis:
1. Acceptkriteriet er nået (exit-kode 0), **og**
2. Klyngetemaerne er genkendelige og handlingsbare når du læser dem — ikke bare statistisk sammenhængende.

Hvis kriteriet ikke nås: skift klynge-input fra `primary_gap` til `reasoning` (kortere og mere formelagtigt) ved at ændre `buildClusterInputText` og dets tests, og kør igen. **Brug ikke penge på Task 5-7 før denne gate er passeret.**

- [ ] **Step 5: Commit**

```bash
git add supabase/scripts/cluster-eval-gaps.mjs
git commit -m "feat(eval): add gap clustering script with KB-verified typing"
```

---

### Task 5: Stratificerings-sampler

**Files:**
- Create: `apps/web/lib/server/benchmark-sampler.js`
- Test: `tests/benchmark-sampler.test.mjs`

**Interfaces:**
- Consumes: intet fra tidligere tasks
- Produces:
  - `EMAIL_CATEGORIES: string[]` — spejling af `supabase/functions/_shared/email-category.ts`
  - `buildCategoryPrompt(ticket) -> { system, user }`
  - `parseCategoryResponse(jsonText) -> string`
  - `stratifiedSample(tickets, { size, floor }) -> ticket[]`

- [ ] **Step 1: Write the failing test**

Opret `tests/benchmark-sampler.test.mjs`:

```javascript
// Run with: node --test tests/
//
// Launch-benchmark sampler: rene helpers til kategorisering og stratificeret
// udvælgelse. Ingen I/O.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EMAIL_CATEGORIES,
  buildCategoryPrompt,
  parseCategoryResponse,
  stratifiedSample,
} from "../apps/web/lib/server/benchmark-sampler.js";

// Taksonomien er spejlet fra Deno-TS-modulet, som ikke kan importeres herfra.
// Denne test fejler hvis de to lister driver fra hinanden.
test("EMAIL_CATEGORIES matcher taksonomien i email-category.ts", () => {
  const src = readFileSync(
    new URL("../supabase/functions/_shared/email-category.ts", import.meta.url),
    "utf8",
  );
  const block = src.match(/export const EMAIL_CATEGORIES = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "kunne ikke finde EMAIL_CATEGORIES i email-category.ts");
  const fromTs = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(EMAIL_CATEGORIES, fromTs);
});

test("buildCategoryPrompt medtager emne og body og lister kategorierne", () => {
  const { system, user } = buildCategoryPrompt({
    subject: "Hvor er min pakke?",
    body: "Jeg bestilte for en uge siden.",
  });
  assert.match(system, /Tracking/);
  assert.match(system, /General/);
  assert.match(user, /Hvor er min pakke\?/);
  assert.match(user, /bestilte for en uge siden/);
});

test("parseCategoryResponse accepterer gyldig kategori", () => {
  assert.equal(parseCategoryResponse(JSON.stringify({ category: "Return" })), "Return");
});

test("parseCategoryResponse falder tilbage til General ved ukendt kategori", () => {
  assert.equal(parseCategoryResponse(JSON.stringify({ category: "Vrovl" })), "General");
});

test("parseCategoryResponse falder tilbage til General ved ugyldig JSON", () => {
  assert.equal(parseCategoryResponse("ikke json"), "General");
});

// --- stratificering --------------------------------------------------------

const pool = [
  ...Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, category: "Tracking" })),
  ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, category: "Return" })),
  ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, category: "Warranty" })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `g${i}`, category: "Gift card" })),
];

test("stratifiedSample rammer den oenskede stoerrelse", () => {
  const sample = stratifiedSample(pool, { size: 50, floor: 5 });
  assert.equal(sample.length, 50);
});

test("stratifiedSample bevarer de store kategoriers andel omtrent", () => {
  const sample = stratifiedSample(pool, { size: 50, floor: 5 });
  const tracking = sample.filter((t) => t.category === "Tracking").length;
  // 60/100 af puljen; med gulv paa smaa kategorier forventes lidt under 30.
  assert.ok(tracking >= 22 && tracking <= 30, `tracking var ${tracking}`);
});

test("stratifiedSample giver smaa kategorier mindst gulvet", () => {
  const sample = stratifiedSample(pool, { size: 50, floor: 5 });
  const warranty = sample.filter((t) => t.category === "Warranty").length;
  assert.ok(warranty >= 5, `warranty var ${warranty}`);
});

test("stratifiedSample tager aldrig flere end kategorien har", () => {
  const sample = stratifiedSample(pool, { size: 50, floor: 5 });
  const gift = sample.filter((t) => t.category === "Gift card").length;
  assert.equal(gift, 2);
});

test("stratifiedSample returnerer hele puljen naar size overstiger den", () => {
  const sample = stratifiedSample(pool, { size: 500, floor: 5 });
  assert.equal(sample.length, pool.length);
});

test("stratifiedSample haandterer tom pulje", () => {
  assert.deepEqual(stratifiedSample([], { size: 10, floor: 5 }), []);
});

test("benchmark-sampler importerer hverken supabase eller laver netvaerkskald", () => {
  const src = readFileSync(
    new URL("../apps/web/lib/server/benchmark-sampler.js", import.meta.url),
    "utf8",
  );
  assert.equal(/@supabase\/supabase-js/.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/benchmark-sampler.test.mjs`
Expected: FAIL med `Cannot find module '.../benchmark-sampler.js'`

- [ ] **Step 3: Write minimal implementation**

Opret `apps/web/lib/server/benchmark-sampler.js`:

```javascript
// Launch-benchmark sampler: rene helpers.
//
// Ingen Supabase-klient og intet netværk — supabase/scripts/build-launch-benchmark.mjs
// gør al I/O.
//
// EMAIL_CATEGORIES er SPEJLET fra supabase/functions/_shared/email-category.ts,
// som er Deno-TS og ikke kan importeres herfra. tests/benchmark-sampler.test.mjs
// læser TS-filen og fejler hvis listerne driver fra hinanden.

export const EMAIL_CATEGORIES = [
  "Tracking",
  "Return",
  "Exchange",
  "Product question",
  "Technical support",
  "Payment",
  "Cancellation",
  "Refund",
  "Address change",
  "Wrong item",
  "Missing item",
  "Complaint",
  "Fraud / dispute",
  "Warranty",
  "Gift card",
  "General",
];

const FALLBACK_CATEGORY = "General";

export function buildCategoryPrompt(ticket = {}) {
  const system = [
    "Du kategoriserer indgående kundeservicehenvendelser til en webshop.",
    `Vælg præcis én kategori fra denne liste: ${EMAIL_CATEGORIES.join(", ")}.`,
    'Svar KUN med JSON på formen {"category": ...}.',
    `Er du i tvivl, vælg "${FALLBACK_CATEGORY}".`,
  ].join("\n");

  const user = [
    `Emne: ${String(ticket.subject ?? "").trim()}`,
    "--- BESKED ---",
    String(ticket.body ?? "").trim().slice(0, 2000),
  ].join("\n");

  return { system, user };
}

export function parseCategoryResponse(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return FALLBACK_CATEGORY;
  }
  const category = String(parsed?.category ?? "").trim();
  return EMAIL_CATEGORIES.includes(category) ? category : FALLBACK_CATEGORY;
}

// Stratificeret udvælgelse: hver kategoris andel i stikprøven svarer til dens
// andel i puljen, men med et gulv så små men dyre kategorier ikke forsvinder.
// Rest-pladser fordeles til de kategorier der har flest tilbage, så vi altid
// rammer den ønskede størrelse når puljen er stor nok.
export function stratifiedSample(tickets = [], { size = 150, floor = 5 } = {}) {
  if (tickets.length === 0) return [];
  if (tickets.length <= size) return [...tickets];

  const byCategory = new Map();
  for (const ticket of tickets) {
    const key = ticket.category || FALLBACK_CATEGORY;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(ticket);
  }

  const quotas = new Map();
  for (const [category, items] of byCategory) {
    const proportional = Math.round((items.length / tickets.length) * size);
    quotas.set(category, Math.min(items.length, Math.max(floor, proportional)));
  }

  // Justér til præcis `size`: skær fra de største kategorier, læg til dem der
  // har uudnyttet kapacitet.
  const total = () => [...quotas.values()].reduce((a, b) => a + b, 0);
  const byDescQuota = () =>
    [...quotas.entries()].sort((a, b) => b[1] - a[1]);

  while (total() > size) {
    const [category, quota] = byDescQuota()[0];
    if (quota <= 1) break;
    quotas.set(category, quota - 1);
  }
  while (total() < size) {
    const candidates = [...quotas.entries()]
      .filter(([c, q]) => q < byCategory.get(c).length)
      .sort((a, b) => byCategory.get(b[0]).length - byCategory.get(a[0]).length);
    if (candidates.length === 0) break;
    const [category, quota] = candidates[0];
    quotas.set(category, quota + 1);
  }

  const sample = [];
  for (const [category, quota] of quotas) {
    sample.push(...byCategory.get(category).slice(0, quota));
  }
  return sample;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/benchmark-sampler.test.mjs`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/server/benchmark-sampler.js tests/benchmark-sampler.test.mjs
git commit -m "feat(eval): add stratified benchmark sampler with category mirror test"
```

---

### Task 6: Støjfilter og paginering i Zendesk-harvesten

**Files:**
- Create: `apps/web/lib/server/eval-noise-filter.js`
- Modify: `apps/web/app/api/eval/zendesk-tickets/route.js:131` (`NON_SUPPORT_PATTERNS`), `:100-118` (ticket-hentning), `:150-160` (comments-hentning)
- Create: `tests/zendesk-noise-filter.test.mjs`

**Interfaces:**
- Consumes: intet fra tidligere tasks
- Produces: `isNoiseSubject(subject: string) -> boolean` fra `apps/web/lib/server/eval-noise-filter.js`

**Bemærk:** helperen lægges i `lib/server/`, ikke i route-filen. Next.js App Router validerer eksporterne fra `route.js` mod en fast liste (`GET`, `POST`, `dynamic`, `revalidate` …), og en vilkårlig ekstra eksport kan få buildet til at fejle med "does not match the required types". Det matcher desuden repoets eksisterende opdeling mellem rene helpers og ruter.

Ruten filtrerer i dag `NON_SUPPORT_PATTERNS` (faktura/betaling) men **ikke** transportør-notifikationer. DHL-adviseringer alene udgør 24 beskeder på 14 dage. Uden dette filter æder støj sample-budgettet.

- [ ] **Step 1: Write the failing test**

Opret `tests/zendesk-noise-filter.test.mjs`:

```javascript
// Run with: node --test tests/
//
// Stoejfilter for Zendesk-harvesten. Transportoer- og kontonotifikationer maa
// ikke aede sample-budgettet, men aegte support-tickets OM forsendelse skal
// bevares.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isNoiseSubject } from "../apps/web/lib/server/eval-noise-filter.js";

test("filtrerer transportoer-notifikationer fra", () => {
  assert.equal(isNoiseSubject("DHL forsendelsesadvisering : 5739299020"), true);
  assert.equal(isNoiseSubject("Der er nyt om din PostNord-pakke"), true);
  assert.equal(isNoiseSubject("Vi leverer snart din pakke fra ACEZONE ApS"), true);
});

test("filtrerer kontonotifikationer fra", () => {
  assert.equal(isNoiseSubject("Administrer din kontoadgang"), true);
});

test("filtrerer faktura og betaling fra (eksisterende adfaerd bevares)", () => {
  assert.equal(isNoiseSubject("MANGLENDE BETALING - 129052"), true);
  assert.equal(isNoiseSubject("Invoice #4021"), true);
});

test("bevarer aegte support-tickets om forsendelse", () => {
  assert.equal(isNoiseSubject("Min pakke er ikke kommet - hvad goer jeg?"), false);
  assert.equal(isNoiseSubject("Kan I sende med DHL i stedet?"), false);
  assert.equal(isNoiseSubject("Forkert leveringsadresse paa min ordre"), false);
});

test("bevarer almindelige support-emner", () => {
  assert.equal(isNoiseSubject("Fejl paa A-Spire Wireless headset"), false);
  assert.equal(isNoiseSubject("Spare microphone holder?"), false);
  assert.equal(isNoiseSubject(""), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/zendesk-noise-filter.test.mjs`
Expected: FAIL med `Cannot find module '.../eval-noise-filter.js'`

- [ ] **Step 3: Write minimal implementation**

Opret `apps/web/lib/server/eval-noise-filter.js`:

```javascript
// Emne-stoejfilter for eval-harvesten. Ren helper — ingen I/O.

// Emner der aldrig er support-henvendelser. Faktura/betaling var her i forvejen;
// transportoer- og kontonotifikationer er tilfoejet fordi de ellers aeder
// sample-budgettet (DHL-adviseringer alene: 24 beskeder paa 14 dage).
//
// Moenstrene matcher NOTIFIKATIONENS form, ikke bare et transportoernavn — en
// aegte support-ticket der naevner DHL skal bevares.
const NOISE_SUBJECT_PATTERNS = [
  /\b(faktura|invoice|payment reminder|påmindelse|bill|betaling|regning|bolls)\b/i,
  /forsendelsesadvisering/i,
  /\ber nyt om din\b/i,
  /\bvi leverer snart\b/i,
  /\bdin (pakke|forsendelse) (er|fra)\b/i,
  /track(ing)? (your|din) (order|pakke)/i,
  /\badministrer din kontoadgang\b/i,
  /\b(nulstil|reset) (dit|your) (password|adgangskode)\b/i,
];

export function isNoiseSubject(subject) {
  const value = String(subject || "").trim();
  if (!value) return false;
  return NOISE_SUBJECT_PATTERNS.some((pattern) => pattern.test(value));
}
```

Fjern derefter `NON_SUPPORT_PATTERNS`-konstanten fra `route.js` (linje ~131), tilføj importen øverst i filen:

```javascript
import { isNoiseSubject } from "@/lib/server/eval-noise-filter";
```

og erstat filter-kaldet i `GET` (linje ~136) fra:

```javascript
      if (NON_SUPPORT_PATTERNS.test(String(t.subject || ""))) return false;
```

til:

```javascript
      if (isNoiseSubject(t.subject)) return false;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/zendesk-noise-filter.test.mjs`
Expected: PASS — 5 tests

- [ ] **Step 5: Tilføj paginering og tidsinterval**

Ruten henter i dag ét vindue af de nyeste solved+closed tickets, cappet på 150. Puljen skal dække ~6 måneder. Erstat `limit`-udledningen og de to `fetch`-kald (linje ~100-118) med:

```javascript
  const { searchParams } = new URL(req.url);
  // Haevet fra 150: puljen skal daekke ~6 maaneder for at stratificering giver mening.
  const limit = Math.min(Number(searchParams.get("limit") || "30"), 600);
  const since = searchParams.get("since") || null; // ISO-dato, fx 2026-01-25
  const maxPages = Math.ceil(limit / 100);

  async function fetchAllPages(status) {
    const collected = [];
    let url = `${baseUrl}/api/v2/tickets.json?status=${status}&sort_by=created_at&sort_order=desc&per_page=100`;
    for (let page = 0; page < maxPages && url; page += 1) {
      const res = await fetch(url, {
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!res.ok) break;
      const data = await res.json().catch(() => ({ tickets: [], next_page: null }));
      const batch = data.tickets || [];
      collected.push(...batch);
      // Stop naar vi er naaet foer `since` — listen er sorteret faldende.
      if (since && batch.some((t) => new Date(t.created_at) < new Date(since))) break;
      url = data.next_page || null;
    }
    return collected;
  }

  const [solvedTickets, closedTickets] = await Promise.all([
    fetchAllPages("solved"),
    fetchAllPages("closed"),
  ]);
```

Tilpas den efterfølgende merge til at bruge `solvedTickets` / `closedTickets` i stedet for `solvedData.tickets` / `closedData.tickets`, og tilføj `since`-filtret i samme `.filter()` hvor `isNoiseSubject` kaldes:

```javascript
      if (since && new Date(t.created_at) < new Date(since)) return false;
```

- [ ] **Step 6: Parallelisér comments-hentningen**

Comments hentes i dag med ét sekventielt kald pr. ticket. Ved 400 tickets timer det ud. Erstat `for (const ticket of tickets) { ... }`-løkken med en pulje-baseret variant med begrænset parallelitet:

```javascript
  // Zendesk rate-limiter aggressivt; 5 samtidige er et sikkert leje.
  const CONCURRENCY = 5;
  const results = [];

  async function processTicket(ticket) {
    // ... uændret krop fra den nuværende løkke, men returnér objektet
    // i stedet for at kalde results.push() direkte.
  }

  for (let i = 0; i < tickets.length; i += CONCURRENCY) {
    const batch = tickets.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(batch.map((t) => processTicket(t).catch(() => null)));
    results.push(...settled.filter(Boolean));
  }
```

Løkkens `continue`-udtryk bliver til `return null` i `processTicket`.

- [ ] **Step 7: Verificér mod den rigtige rute**

```bash
node --test tests/
```
Expected: PASS — alle tests, ingen regression i eksisterende suiter.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/server/eval-noise-filter.js apps/web/app/api/eval/zendesk-tickets/route.js tests/zendesk-noise-filter.test.mjs
git commit -m "feat(eval): add noise filter, pagination and concurrency to zendesk harvest"
```

---

### Task 7: Frys de 150 cases og kør baseline

**Files:**
- Create: `supabase/scripts/build-launch-benchmark.mjs`

**Interfaces:**
- Consumes: `EMAIL_CATEGORIES`, `buildCategoryPrompt`, `parseCategoryResponse`, `stratifiedSample` fra Task 5; `ACEZONE_SHOP_ID` fra `golden-eval-core.mjs`; den udvidede rute fra Task 6
- Produces: 150 rækker i `gold_eval_cases` med snapshot af ticket-body og menneskesvar

- [ ] **Step 1: Skriv scriptet**

Opret `supabase/scripts/build-launch-benchmark.mjs`:

```javascript
// supabase/scripts/build-launch-benchmark.mjs
//
// Bygger det frosne launch-benchmark: harvester loeste Zendesk-tickets via
// /api/eval/zendesk-tickets, kategoriserer dem med EMAIL_CATEGORIES-taksonomien,
// udvaelger stratificeret, og fryser resultatet i gold_eval_cases.
//
// Casen gemmes MED snapshot af ticket-body og menneskesvar — ikke kun
// zendesk_ticket_id. Det er fejlen der gjorde de 33 cases fra 4. juni svaere at
// stole paa: naar kilden aendrer sig, er genkoerslen ikke laengere den samme test.
//
// Dry-run som standard.
//
// Run:
//   set -a && source apps/web/.env.local && set +a
//   node supabase/scripts/build-launch-benchmark.mjs --since 2026-01-25 --size 150
//   node supabase/scripts/build-launch-benchmark.mjs --since 2026-01-25 --size 150 --apply
import { createClient } from "@supabase/supabase-js";
import { ACEZONE_SHOP_ID } from "./lib/golden-eval-core.mjs";
import {
  buildCategoryPrompt,
  parseCategoryResponse,
  stratifiedSample,
} from "../../apps/web/lib/server/benchmark-sampler.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const since = argValue("--since", null);
const size = Number(argValue("--size", "150"));
const harvestLimit = Number(argValue("--harvest-limit", "400"));
const appBaseUrl = process.env.EVAL_APP_BASE_URL || "http://localhost:3000";

if (!since) {
  console.error("build-launch-benchmark: --since <ISO-dato> er påkrævet");
  process.exit(2);
}

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ""
).replace(/\/$/, "");
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const EVAL_SESSION_COOKIE = process.env.EVAL_SESSION_COOKIE || "";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("build-launch-benchmark: mangler env — source apps/web/.env.local først");
  process.exit(2);
}
if (!EVAL_SESSION_COOKIE) {
  console.error(
    "build-launch-benchmark: EVAL_SESSION_COOKIE mangler. Ruten er Clerk-beskyttet — kopiér din session-cookie fra browseren.",
  );
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
// Kategorisering er en simpel etiketteringsopgave; den billige model raekker.
const categoryModel = process.env.OPENAI_CATEGORY_MODEL || "gpt-4o-mini";

// --- 1. harvest ------------------------------------------------------------

const harvestUrl = `${appBaseUrl}/api/eval/zendesk-tickets?limit=${harvestLimit}&since=${since}`;
const harvestRes = await fetch(harvestUrl, {
  headers: { Cookie: EVAL_SESSION_COOKIE },
});
if (!harvestRes.ok) {
  console.error(`build-launch-benchmark: harvest fejlede (${harvestRes.status})`);
  process.exit(1);
}
const { tickets = [] } = await harvestRes.json();
console.error(`build-launch-benchmark: ${tickets.length} tickets harvestet siden ${since}`);

if (tickets.length < size) {
  console.error(
    `build-launch-benchmark: puljen (${tickets.length}) er mindre end --size (${size}). Sænk --size eller flyt --since længere tilbage.`,
  );
  process.exit(1);
}

// --- 2. kategorisér --------------------------------------------------------

async function categorize(ticket) {
  const { system, user } = buildCategoryPrompt({
    subject: ticket.subject,
    body: ticket.customer_message || ticket.ticket_body || "",
  });
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: categoryModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) return { ...ticket, category: "General" };
  const data = await resp.json();
  return { ...ticket, category: parseCategoryResponse(data.choices[0].message.content) };
}

const CONCURRENCY = 8;
const categorized = [];
for (let i = 0; i < tickets.length; i += CONCURRENCY) {
  const batch = tickets.slice(i, i + CONCURRENCY);
  categorized.push(...(await Promise.all(batch.map(categorize))));
}

const histogram = categorized.reduce((acc, t) => {
  acc[t.category] = (acc[t.category] || 0) + 1;
  return acc;
}, {});
console.error("build-launch-benchmark: kategorifordeling i puljen:", histogram);

// --- 3. stratificér --------------------------------------------------------

const selected = stratifiedSample(categorized, { size, floor: 5 });
const selectedHistogram = selected.reduce((acc, t) => {
  acc[t.category] = (acc[t.category] || 0) + 1;
  return acc;
}, {});
console.error(`build-launch-benchmark: ${selected.length} udvalgt:`, selectedHistogram);

// --- 4. frys ---------------------------------------------------------------

const rows = selected.map((ticket) => ({
  shop_id: ACEZONE_SHOP_ID,
  case_key: `launch-2026-07:${ticket.zendesk_ticket_id ?? ticket.id}`,
  category: ticket.category,
  // Snapshot: casen skal kunne genkoeres identisk selv om kilden aendrer sig.
  ticket_subject: ticket.subject ?? null,
  ticket_body: ticket.customer_message ?? ticket.ticket_body ?? null,
  human_reply: ticket.human_reply ?? null,
  conversation_history: ticket.conversation ?? null,
  zendesk_ticket_id: ticket.zendesk_ticket_id ?? ticket.id ?? null,
}));

if (!apply) {
  console.error("build-launch-benchmark: DRY RUN — ingen skrivninger. Kør med --apply.");
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  process.exit(0);
}

const { error } = await supabase
  .from("gold_eval_cases")
  .upsert(rows, { onConflict: "case_key" });
if (error) {
  console.error("build-launch-benchmark: upsert fejlede:", error.message);
  process.exit(1);
}
console.error(`build-launch-benchmark: ${rows.length} cases frosset i gold_eval_cases`);
```

- [ ] **Step 2: Verificér `gold_eval_cases`-skemaet før første kørsel**

Scriptet antager kolonnerne `case_key, category, ticket_subject, ticket_body, human_reply, conversation_history, zendesk_ticket_id`. Bekræft mod den faktiske tabel:

```bash
set -a && source apps/web/.env.local && set +a
node -e '
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
sb.from("gold_eval_cases").select("*").limit(1).then(({ data, error }) => {
  if (error) return console.error(error.message);
  console.log(Object.keys(data[0] || {}));
});'
```

Mangler der kolonner (fx `category`, `human_reply`), skriv en migration i `supabase/migrations/` der tilføjer dem som nullable `text`/`jsonb`, kør den, og fortsæt først derefter. **Deploy aldrig kode der afhænger af en ukørt migration** — jf. postmark-lifecycle-incidenten.

- [ ] **Step 3: Dry-run**

```bash
node supabase/scripts/build-launch-benchmark.mjs --since 2026-01-25 --size 150
```

Expected: kategorifordeling for både pulje og udvalg på stderr, tre eksempel-rækker på stdout, ingen skrivninger. Kontrollér at fordelingen ser plausibel ud, og at ingen kategori er tom af tekniske grunde.

- [ ] **Step 4: Apply**

```bash
node supabase/scripts/build-launch-benchmark.mjs --since 2026-01-25 --size 150 --apply
```

Expected: `150 cases frosset i gold_eval_cases`

- [ ] **Step 5: Kør baseline-evalen**

Kør eval over de 150 frosne cases via EvalPanel eller `/api/eval/run` med `run_label` = `launch-baseline-2026-07-25`.

Forventet: ~45 min, ~38 kr. Kontrollér undervejs at fejlantallet ikke stiger — `eval_runs.error_count`.

- [ ] **Step 6: Kør klyngelaget på baseline**

```bash
node supabase/scripts/cluster-eval-gaps.mjs \
  --run-label "launch-baseline-2026-07-25" \
  --threshold <kalibreret fra Task 4> \
  --out docs/superpowers/reports/2026-07-25-launch-baseline-klynger.md
```

- [ ] **Step 7: Commit rapport og script**

```bash
git add supabase/scripts/build-launch-benchmark.mjs docs/superpowers/reports/2026-07-25-launch-baseline-klynger.md
git commit -m "feat(eval): freeze 150-case launch benchmark and add baseline cluster report"
```

---

## Efter planen

Rapporten fra Task 7 er ugens arbejdsliste. Læs den ovenfra:

- **`knowledge_gap`-klynger** → skriv knowledge. Læg de afgørende linjer i sektionstoppen; concise-mode capper chunks ved 600 tegn.
- **`retrieval_miss`-klynger** → matcher/scoring-arbejde. Skriv ikke ny viden — den findes.
- **`intent_miss`-klynger** → planner/prompt-arbejde. Forventes ikke løst inden lancering.

Genkør derefter `launch-baseline-2026-07-25`-sættet under et nyt `run_label` og sammenlign. Målet fra spec'en: `send_ready` mindst firedoblet fra baseline, snit `overall_10` mindst +1,0, på uændret population.
