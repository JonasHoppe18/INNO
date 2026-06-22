// supabase/functions/generate-draft-v2/stages/live-commerce-retrieval-gate.ts
//
// Stage 5, Slice 2A — intent-aware retrieval down-ranking for live-commerce
// tickets.
//
// When a ticket is a pure live-commerce intent (tracking / order status /
// cancel / address change / refund / return) AND authoritative live order facts
// are present, legacy *factual* retrieval (manual_text / saved_reply) can
// contaminate the answer even though the live facts already hold the truth
// (observed in prod: a "Where is my order?" manual_text chunk retrieved next to
// live tracking facts). This PURE module partitions retrieved chunks into the
// set the writer should see (`kept`) and the legacy factual chunks to suppress
// (`suppressed`).
//
// Hard safety rules (enforced by tests):
//   - ONLY gates pure live-commerce intents, and ONLY when live order facts
//     exist. Otherwise every chunk is kept (no behavior change).
//   - NEVER suppresses policy or procedure chunks — returns/refund policy and
//     documented procedures stay retrievable even on refund/return intents.
//   - Only manual_text / saved_reply *factual* sources are suppressed. Nothing
//     is deleted from the DB; this only affects in-memory source selection.

// Pure live-status intents: live order facts + deterministic actions fully
// answer these, so legacy manual_text/saved_reply is redundant — suppressed
// REGARDLESS of its usable_as tag (this is what catches row 4321, which is
// manual_text but explicitly tagged usable_as='procedure').
export const LIVE_STATUS_INTENTS = new Set([
  "tracking",
  "order_status",
  "cancel",
  "address_change",
]);

// Policy-needing intents: the reply may need return steps, refund procedure,
// return address or warranty guidance, so policy/procedure is PRESERVED — only
// clearly risky legacy fact/saved_reply chunks are suppressed.
export const POLICY_NEEDING_INTENTS = new Set([
  "return",
  "refund",
  "exchange",
]);

export function isLiveCommerceIntent(intent: string | null | undefined): boolean {
  const i = String(intent ?? "").toLowerCase();
  return LIVE_STATUS_INTENTS.has(i) || POLICY_NEEDING_INTENTS.has(i);
}

// Minimal structural shape — defined locally so this module stays dependency-
// free. The pipeline passes RetrievedChunk[], which is structurally compatible.
export interface GateChunk {
  source_provider?: string | null;
  usable_as?: string | null;
  kind?: string | null;
}

export interface GateResult<T> {
  kept: T[];
  suppressed: T[];
}

// Retrieval source providers treated as legacy *factual* sources that the live
// facts supersede on a live-commerce ticket.
const LEGACY_FACTUAL_PROVIDERS = new Set(["manual_text", "saved_reply"]);

// usable_as classes that must NEVER be suppressed — policy guidance and
// documented procedures stay retrievable even on refund/return tickets.
const PROTECTED_USABLE_AS = new Set(["policy", "procedure"]);

// A legacy retrieval source whose authority the live facts supersede.
function isLegacyProviderChunk(chunk: GateChunk): boolean {
  const provider = String(chunk.source_provider ?? "").toLowerCase();
  const usableAs = String(chunk.usable_as ?? "").toLowerCase();
  return LEGACY_FACTUAL_PROVIDERS.has(provider) || usableAs === "saved_reply";
}

// Whether a given legacy chunk should be suppressed for the intent group.
//  - status intents: suppress regardless of usable_as (catches manual_text
//    tagged 'procedure', e.g. row 4321).
//  - policy intents: preserve policy/procedure (return steps / refund procedure
//    / warranty guidance); suppress only fact/saved_reply/background legacy.
function shouldSuppress(chunk: GateChunk, intent: string): boolean {
  if (!isLegacyProviderChunk(chunk)) return false; // never touch non-legacy (knowledge_document, shopify_policy, products…)
  if (LIVE_STATUS_INTENTS.has(intent)) return true;
  if (POLICY_NEEDING_INTENTS.has(intent)) {
    const usableAs = String(chunk.usable_as ?? "").toLowerCase();
    return !PROTECTED_USABLE_AS.has(usableAs);
  }
  return false;
}

export function partitionLiveCommerceLegacy<T extends GateChunk>(
  chunks: T[] | null | undefined,
  opts: { intent: string | null | undefined; hasLiveOrder: boolean },
): GateResult<T> {
  const list = Array.isArray(chunks) ? chunks : [];
  const intent = String(opts.intent ?? "").toLowerCase();
  const gating = isLiveCommerceIntent(intent) && opts.hasLiveOrder === true;
  if (!gating) return { kept: [...list], suppressed: [] };

  const kept: T[] = [];
  const suppressed: T[] = [];
  for (const chunk of list) {
    if (shouldSuppress(chunk, intent)) suppressed.push(chunk);
    else kept.push(chunk);
  }
  return { kept, suppressed };
}
