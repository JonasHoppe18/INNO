import { assertEquals } from "jsr:@std/assert@1";
import {
  matchSnippets,
  selectFromRanked,
  type MatchCandidate,
} from "./snippet-matcher.ts";

const OPTS = { model: "gpt-4o-mini", threshold: 0.6, maxSelected: 2, marginMin: 0.15 };

const cands: MatchCandidate[] = [
  { id: "c1", question: "Why can't I change my EQ?", title: "EQ", excerpt: "..." },
  { id: "c2", question: "How do I pair the headset?", title: "Pairing", excerpt: "..." },
];

function stub(rankings: Array<{ id: string; relevance: number; reason?: string }>) {
  // deno-lint-ignore no-explicit-any
  return (_args: any) => Promise.resolve({ rankings } as any);
}

Deno.test("selectFromRanked: single clear winner above threshold", () => {
  const ranked = [
    { id: "c1", relevance: 0.9, reason: "" },
    { id: "c2", relevance: 0.3, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.abstained, false);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("selectFromRanked: two winners within margin → both up to budget", () => {
  const ranked = [
    { id: "c1", relevance: 0.85, reason: "" },
    { id: "c2", relevance: 0.78, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.selected.map((s) => s.id), ["c1", "c2"]);
});

Deno.test("selectFromRanked: #1 clears margin over #2 → only #1", () => {
  const ranked = [
    { id: "c1", relevance: 0.85, reason: "" },
    { id: "c2", relevance: 0.65, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("selectFromRanked: budget caps multi-select", () => {
  const ranked = [
    { id: "c1", relevance: 0.9, reason: "" },
    { id: "c2", relevance: 0.88, reason: "" },
    { id: "c3", relevance: 0.86, reason: "" },
  ];
  const r = selectFromRanked(ranked, { ...OPTS, maxSelected: 2 });
  assertEquals(r.selected.map((s) => s.id), ["c1", "c2"]);
});

Deno.test("selectFromRanked: none above threshold → abstain", () => {
  const ranked = [
    { id: "c1", relevance: 0.5, reason: "" },
    { id: "c2", relevance: 0.2, reason: "" },
  ];
  const r = selectFromRanked(ranked, OPTS);
  assertEquals(r.abstained, true);
  assertEquals(r.selected.length, 0);
});

Deno.test("matchSnippets: empty candidates → abstain, no LLM call", async () => {
  let called = false;
  const r = await matchSnippets("hi", [], OPTS, {
    // deno-lint-ignore no-explicit-any
    callJson: ((_a: any) => { called = true; return Promise.resolve({ rankings: [] } as any); }),
  });
  assertEquals(called, false);
  assertEquals(r.abstained, true);
  assertEquals(r.ranked.length, 0);
});

Deno.test("matchSnippets: selects winner from stubbed ranking", async () => {
  const r = await matchSnippets("Why won't my EQ change?", cands, OPTS, {
    callJson: stub([
      { id: "c1", relevance: 0.9, reason: "answers EQ" },
      { id: "c2", relevance: 0.2, reason: "pairing, unrelated" },
    ]),
  });
  assertEquals(r.abstained, false);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
  assertEquals(r.ranked.length, 2);
});

Deno.test("matchSnippets: topical-but-wrong single candidate → abstain (g-020)", async () => {
  const one: MatchCandidate[] = [
    { id: "c9", question: "How do I pair my mic?", title: "Mic pairing", excerpt: "..." },
  ];
  const r = await matchSnippets("I want to buy a replacement dongle", one, OPTS, {
    callJson: stub([{ id: "c9", relevance: 0.35, reason: "same topic, not the request" }]),
  });
  assertEquals(r.abstained, true);
  assertEquals(r.selected.length, 0);
});

Deno.test("matchSnippets: drops hallucinated ids not in candidates", async () => {
  const r = await matchSnippets("test", cands, OPTS, {
    callJson: stub([
      { id: "ghost", relevance: 0.95, reason: "not real" },
      { id: "c1", relevance: 0.8, reason: "real" },
    ]),
  });
  assertEquals(r.ranked.map((x) => x.id), ["c1"]);
  assertEquals(r.selected.map((s) => s.id), ["c1"]);
});

Deno.test("matchSnippets: clamps out-of-range relevance", async () => {
  const r = await matchSnippets("test", cands, OPTS, {
    callJson: stub([
      { id: "c1", relevance: 1.7, reason: "" },
      { id: "c2", relevance: -0.4, reason: "" },
    ]),
  });
  assertEquals(r.ranked.find((x) => x.id === "c1")?.relevance, 1);
  assertEquals(r.ranked.find((x) => x.id === "c2")?.relevance, 0);
});

// Numeric-id regression (observed live on g-020): chunk ids are numeric strings
// ("4436"), and gpt-4o-mini returns them as JSON numbers. The id filter must
// coerce before comparing — otherwise every ranking is dropped and the matcher
// silently abstains even when the LLM scored the right chunk 1.0.
Deno.test("matchSnippets: accepts numeric ids returned for numeric-string candidates", async () => {
  const numericCands: MatchCandidate[] = [
    { id: "4436", question: null, title: "Missing accessories and spare parts", excerpt: "..." },
    { id: "4516", question: null, title: "Dongle pairing", excerpt: "..." },
  ];
  const r = await matchSnippets("Jeg har smidt min dongle væk — kan jeg købe en ny?", numericCands, OPTS, {
    // deno-lint-ignore no-explicit-any
    callJson: (_args: any) =>
      Promise.resolve({
        rankings: [
          { id: 4436, relevance: 1, reason: "answers the spare-part request" },
          { id: 4516, relevance: 0, reason: "pairing, not purchase" },
        ],
        // deno-lint-ignore no-explicit-any
      } as any),
  });
  assertEquals(r.abstained, false);
  assertEquals(r.ranked.map((x) => x.id), ["4436", "4516"]);
  assertEquals(r.selected.map((s) => s.id), ["4436"]);
});

// Positional-index regression (observed live on e-002): the prompt numbers
// candidates "#N [id: 4443]" and the model sometimes echoes the position
// ("id": 14) instead of the chunk id. Resolve exact ids first; a small integer
// that is NOT a valid chunk id but IS a valid 1-based position maps to that
// candidate. "#14" form counts too.
Deno.test("matchSnippets: resolves positional indexes when ids don't match", async () => {
  const pool: MatchCandidate[] = Array.from({ length: 15 }, (_, i) => ({
    id: String(4400 + i),
    question: null,
    title: `Doc ${i + 1}`,
    excerpt: "...",
  }));
  const r = await matchSnippets("warranty repair?", pool, OPTS, {
    // deno-lint-ignore no-explicit-any
    callJson: (_args: any) =>
      Promise.resolve({
        rankings: [
          { id: 14, relevance: 1, reason: "warranty claims" },
          { id: "#12", relevance: 0.9, reason: "return for swap" },
          { id: 3, relevance: 0, reason: "refunds" },
        ],
        // deno-lint-ignore no-explicit-any
      } as any),
  });
  assertEquals(r.abstained, false);
  // #14 → pool[13] = 4413, #12 → pool[11] = 4411, #3 → pool[2] = 4402
  assertEquals(r.ranked.map((x) => x.id), ["4413", "4411", "4402"]);
  // 1.0 vs 0.9 is inside marginMin 0.15 → both selected up to the budget.
  assertEquals(r.selected.map((s) => s.id), ["4413", "4411"]);
});

Deno.test("matchSnippets: exact chunk-id match wins over positional reading", async () => {
  // Candidate genuinely has id "3" — a returned 3 must mean that chunk,
  // not position #3.
  const pool: MatchCandidate[] = [
    { id: "3", question: null, title: "A", excerpt: "..." },
    { id: "200", question: null, title: "B", excerpt: "..." },
    { id: "300", question: null, title: "C", excerpt: "..." },
  ];
  const r = await matchSnippets("q", pool, OPTS, {
    // deno-lint-ignore no-explicit-any
    callJson: (_args: any) =>
      Promise.resolve({
        rankings: [{ id: 3, relevance: 0.9, reason: "" }],
        // deno-lint-ignore no-explicit-any
      } as any),
  });
  assertEquals(r.ranked.map((x) => x.id), ["3"]);
});

// Send-ready analysis round 2 (2026-07-07): with guide-mode live, the judge
// still flags "missing steps" — the matcher selects ONE section while the
// human's fix spans complementary sibling sections of the same document
// (clear pairing list + pairing guide). Above-threshold sibling sections from
// the same document join the selection, capped at the knowledge budget.
import { augmentWithSameDocumentSiblings } from "./snippet-matcher.ts";

Deno.test("adds above-threshold sibling sections from the same document", () => {
  const byId = new Map<string, { id: string; document_id?: string | null }>([
    ["1", { id: "1", document_id: "doc-A" }],
    ["2", { id: "2", document_id: "doc-A" }],
    ["3", { id: "3", document_id: "doc-B" }],
  ]);
  const out = augmentWithSameDocumentSiblings({
    selected: [byId.get("1")!],
    ranked: [
      { id: "1", relevance: 0.9, reason: "" },
      { id: "2", relevance: 0.7, reason: "" },
      { id: "3", relevance: 0.8, reason: "" },
    ],
    byId,
    threshold: 0.6,
    budget: 2,
  });
  // sibling "2" (same doc, above threshold) joins; "3" (other doc) does not.
  assertEquals(out.map((c) => c.id), ["1", "2"]);
});

Deno.test("respects the budget and skips below-threshold siblings", () => {
  const byId = new Map<string, { id: string; document_id?: string | null }>([
    ["1", { id: "1", document_id: "doc-A" }],
    ["2", { id: "2", document_id: "doc-A" }],
    ["4", { id: "4", document_id: "doc-A" }],
  ]);
  const ranked = [
    { id: "1", relevance: 0.9, reason: "" },
    { id: "2", relevance: 0.5, reason: "" }, // below threshold — never added
    { id: "4", relevance: 0.65, reason: "" },
  ];
  const capped = augmentWithSameDocumentSiblings({
    selected: [byId.get("1")!],
    ranked,
    byId,
    threshold: 0.6,
    budget: 1, // already full — nothing added
  });
  assertEquals(capped.map((c) => c.id), ["1"]);
  const roomy = augmentWithSameDocumentSiblings({
    selected: [byId.get("1")!],
    ranked,
    byId,
    threshold: 0.6,
    budget: 3,
  });
  assertEquals(roomy.map((c) => c.id), ["1", "4"]);
});

Deno.test("no-op when nothing selected or chunks lack document identity", () => {
  const byId = new Map<string, { id: string; document_id?: string | null }>([
    ["1", { id: "1", document_id: null }],
    ["2", { id: "2", document_id: null }],
  ]);
  assertEquals(
    augmentWithSameDocumentSiblings({
      selected: [],
      ranked: [{ id: "2", relevance: 0.9, reason: "" }],
      byId,
      threshold: 0.6,
      budget: 3,
    }),
    [],
  );
  assertEquals(
    augmentWithSameDocumentSiblings({
      selected: [byId.get("1")!],
      ranked: [{ id: "2", relevance: 0.9, reason: "" }],
      byId,
      threshold: 0.6,
      budget: 3,
    }).map((c) => c.id),
    ["1"],
  );
});
