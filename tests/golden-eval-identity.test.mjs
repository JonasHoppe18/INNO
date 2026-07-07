// Run with: node --test tests/
//
// Retrieval-identity convention for the golden eval. The knowledge base now has
// three identity generations: manual snippets (metadata.title), synced sources
// (metadata.source_id), and curated knowledge_document sections whose only
// heading lives in metadata.section_heading / normalized_heading — and whose
// matcher-candidate title is source_label-shaped ("knowledge_document: <heading>").
// These tests pin one shared convention so gold labels, the recall probe, and
// computeRetrievalMetrics all speak the same identity language.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  knowledgeIdentityFromMetadata,
  normalizeRetrievalIdentity,
  computeRetrievalMetrics,
} from "../supabase/scripts/lib/golden-eval-core.mjs";

test("metadata identity prefers source_id, then title, then section heading", () => {
  assert.equal(
    knowledgeIdentityFromMetadata({ source_id: "SRC-9", title: "T" }),
    "src-9",
  );
  assert.equal(knowledgeIdentityFromMetadata({ title: "  Refund Policy " }), "refund policy");
  assert.equal(
    knowledgeIdentityFromMetadata({ section_heading: "Microphone Issues" }),
    "microphone issues",
  );
  assert.equal(
    knowledgeIdentityFromMetadata({ normalized_heading: "factory reset" }),
    "factory reset",
  );
  assert.equal(knowledgeIdentityFromMetadata({}), "");
  assert.equal(knowledgeIdentityFromMetadata(null), "");
});

test("normalize strips a known provider prefix from source_label-shaped titles", () => {
  assert.equal(
    normalizeRetrievalIdentity("knowledge_document: Headset loses connection"),
    "headset loses connection",
  );
  assert.equal(normalizeRetrievalIdentity("manual_text: Contact"), "contact");
  assert.equal(normalizeRetrievalIdentity("  Refund Policy "), "refund policy");
  // Unknown prefixes are content, not providers — keep them.
  assert.equal(
    normalizeRetrievalIdentity("Important: read this first"),
    "important: read this first",
  );
});

test("recall matches a document-section gold label against a source_label-shaped candidate", () => {
  const gold = ["microphone issues"];
  const matcher = {
    candidates: [
      { id: "4531", source_id: null, title: "knowledge_document: Microphone Issues" },
    ],
    ranked: [
      { id: "4531", source_id: null, title: "knowledge_document: Microphone Issues", relevance: 0.9 },
    ],
    selected_ids: ["4531"],
    abstained: false,
  };
  const m = computeRetrievalMetrics(gold, matcher);
  assert.equal(m.recall_at_k, 1);
  assert.equal(m.precision_at_1, 1);
  assert.equal(m.mrr, 1);
});

test("recall still matches classic source_id/title identities", () => {
  const matcher = {
    candidates: [{ id: "1", source_id: "SRC-9", title: "whatever" }],
    ranked: [{ id: "1", source_id: "SRC-9", title: "whatever", relevance: 1 }],
    selected_ids: ["1"],
    abstained: false,
  };
  assert.equal(computeRetrievalMetrics(["src-9"], matcher).recall_at_k, 1);
});
