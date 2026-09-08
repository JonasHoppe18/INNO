# Greenfield Knowledge V1

This document describes the small Knowledge V1 architecture implemented for the
greenfield Sona support agent. It is deliberately separate from the V2/V3
knowledge and orchestration systems.

## Implemented now

The runtime path is:

```text
raw merchant source
  -> deterministic normalization and canonical records
  -> review/lifecycle state
  -> bounded chunks and embeddings
  -> workspace-scoped retrieval
  -> one Sona Support Agent
```

The implementation consists of one knowledge-store contract, one Supabase
store, one authenticated source-ingestion route, and the existing single agent
loop. It does not add a router, intent classifier, planning agent, validation
model, or extra orchestration stage.

The relevant code is:

- `apps/web/lib/greenfield-support/types.ts`: tenant-scoped records, source
  documents, procedure blocks, and the store contract.
- `apps/web/lib/greenfield-support/knowledge.ts`: normalization, deterministic
  procedure parsing, source splitting, chunking, ranking, and retrieval.
- `apps/web/app/api/greenfield-knowledge/source/route.js`: authenticated raw
  Markdown/TXT ingestion.
- `apps/web/lib/server/greenfield-knowledge.js`: API validation and UI
  serialization.
- `apps/web/components/knowledge/GreenfieldKnowledgePageClient.jsx`: native
  procedure editing and source review UI.

## Source and record model

`greenfield_knowledge_sources` is a registry for one raw source. A source has
workspace scope, a stable `(source_kind, source_id)`, an integer version, raw
and normalized content, a SHA-256 content hash, provenance fields, and a
review lifecycle: `draft`, `review`, `published`, or `archived`.

One source may produce many rows in `greenfield_knowledge_records`. Each
record keeps:

- the workspace/tenant and knowledge type;
- authority (`authoritative`, `operational`, `reference`, `guidance`, or
  `example`);
- source UUID, version, hash, source record key, and source location;
- source kind/id/label/URI and observed/published timestamps;
- applicability metadata where relevant; and
- canonical structured data plus the source content.

The Markdown/TXT prototype splits heading-delimited sections into candidates.
It does not ask a model to rewrite the source. Candidate records are created
as drafts so a merchant can review them before publication.

Re-ingesting an unchanged source is idempotent. A changed source increments
the source version, upserts the candidate records, rebuilds their chunks, and
marks records removed from the new source as `unpublished` with
`source_refresh_state=removed`. Existing lifecycle/applicability decisions are
not silently overwritten when an already-known record is adopted by a source.

## Canonical procedures

Procedures are not stored only as an opaque paragraph. Their canonical shape
is:

```json
{
  "procedure": {
    "task": { "key": "factory_reset", "title": "Factory reset" },
    "aliases": ["reset my headset"],
    "blocks": [
      { "block_id": "block_1", "kind": "prerequisite", "text": "...", "list_style": null },
      { "block_id": "block_2", "kind": "instruction", "text": "...", "list_style": "ordered" },
      { "block_id": "block_3", "kind": "warning", "text": "...", "list_style": null },
      { "block_id": "block_4", "kind": "expected_result", "text": "...", "list_style": null }
    ]
  }
}
```

The supported semantic kinds are `heading`, `prerequisite`, `instruction`,
`note`, `warning`, `condition`, `expected_result`, and `alternative`. The
parser recognizes explicit labels and list order conservatively. Unlabelled
prose remains an `instruction`; source text, order, line, and excerpt
provenance are retained. Each block has a stable identifier for response
citations, while source order remains deterministic. Product applicability is separate from task identity,
so two procedures for the same product remain distinct.

Legacy procedural rows remain readable. If they do not yet have canonical
blocks, the runtime exposes their source paragraphs as instruction blocks
until a merchant edits or re-ingests them.

## Lifecycle and authority

New source candidates start as `draft`. Retrieval excludes draft,
unpublished, and archived records. The existing imported greenfield corpus has
no lifecycle marker and is treated as published for backward compatibility.

Authority is question-dependent:

| Knowledge class | Use | Authority | Freshness |
| --- | --- | --- | --- |
| Merchant policy | Returns, refunds, shipping, warranty | Authoritative | Republish when policy changes |
| Product knowledge | Facts, compatibility, manuals, troubleshooting | Reference | Update with catalogue/manual changes |
| Procedures | Support troubleshooting and next steps | Operationally authoritative | Review when workflow changes |
| Brand guidance | Tone, terminology, language | Guidance | Review when brand guidance changes |
| Historical cases | Examples of solved conversations | Evidence/example only | Historical; never policy |
| Live operational data | Order, fulfilment, shipment, customer state | Verified at lookup time | Fetch at response time |

Historical cases can support retrieval as examples, but cannot silently
override merchant policy. Live order and shipment facts come from tenant-safe
read-only tools rather than stale knowledge rows.

## Retrieval

Retrieval remains behind the existing `KnowledgeStore` interface. It is
workspace-scoped in application code and in the Supabase queries, supports
semantic ranking with lexical fallback, and applies product applicability
fail-closed when a product is explicitly known. The ranking reads both the
canonical structured applicability and the legacy metadata representation so
existing DEV records do not lose applicability during the transition.

The agent receives bounded evidence with provenance. A failed search is an
unknown result, not a business fact. The response contract remains source-bound
for policy and procedure claims. Procedure guidance prefers stable `block_id`
citations; legacy indexed `step_paths` remain supported for compatibility.
Chunks and embeddings are derived data: published-record ingestion repairs
missing embeddings without changing the canonical record.

## Review workflow

The Knowledge UI supports two small workflows:

1. Create or edit one merchant-authored record, including a native procedure
   task, aliases, ordered blocks, semantic block kinds, applicability, and
   lifecycle status.
2. Paste a Markdown/TXT source, split it deterministically into section
   candidates, and review the resulting draft records individually.

The source route resolves the authenticated workspace server-side. It does not
accept a workspace identifier from the browser as authority. Tenant isolation,
field validation, lifecycle transitions, and the distinction between source
records and chunks remain deterministic code paths.

## Future, not implemented in V1

The following are intentionally deferred until evaluation demonstrates a need:

- broad crawling, connectors, or bulk migration of all Sona data;
- model-based extraction or rewriting of source content;
- automatic publication without merchant review;
- embeddings as a new orchestration layer or a second agent;
- source diff UI beyond deterministic version/hash handling;
- historical-case anonymization and dedicated historical ingestion;
- write actions such as refunds, cancellations, returns, replacements, or
  address changes.

These are not hidden dependencies of the current agent. The current goal is to
measure whether a small canonical knowledge layer plus one support agent is
reliable against real Sona development data.
