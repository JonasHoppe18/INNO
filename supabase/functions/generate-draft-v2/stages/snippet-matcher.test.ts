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
