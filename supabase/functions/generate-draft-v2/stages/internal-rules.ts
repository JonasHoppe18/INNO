// supabase/functions/generate-draft-v2/stages/internal-rules.ts
//
// Deterministic injection of INTERNAL rules into the writer prompt.
//
// Why this exists (and why it is NOT part of the retriever):
// Embedding retrieval is probabilistic — a shop's most important operating
// rule ("a broken mic = a Return For Swap case, route to the production
// department, never promise a replacement before approval") might not surface
// for a given customer phrasing. Worse, if such an internal rule is written as
// a normal knowledge snippet, the writer can quote it verbatim and leak
// internal terminology / process to the customer.
//
// Internal rules are therefore treated like pinned policy: fetched
// deterministically by shop_id + intent, never embedding-matched, and rendered
// in a dedicated block the writer must follow for PROCEDURE/ACTION/TERMINOLOGY
// but must never copy verbatim into the customer-facing reply.
//
// Data convention (no migration needed — agent_knowledge.metadata is jsonb):
//   metadata.audience        = "internal"        → this row is an internal rule
//   metadata.trigger_intent  = ["exchange", ...] → intents this rule applies to
//                                                   (empty/absent = applies to all)
//   metadata.title           = short label shown to the writer for context
//
// Customer-facing knowledge keeps audience="customer" (or absent) and continues
// to flow through the normal retriever path unchanged.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface InternalRule {
  id: string;
  title: string;
  content: string;
  trigger_intent: string[];
}

export interface InternalRulesResult {
  rules: InternalRule[];
  /** Pre-rendered block ready to drop into the writer userContent (or ""). */
  block: string;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fetch internal rules for a shop, filtered to those whose trigger_intent
 * overlaps the current plan intent (rules with no trigger_intent apply to all
 * intents). Pure deterministic DB read — no embeddings, no LLM.
 */
export async function runInternalRules(input: {
  shop_id: string;
  primary_intent: string;
  supabase: SupabaseClient;
}): Promise<InternalRulesResult> {
  const { shop_id, primary_intent, supabase } = input;
  const intent = String(primary_intent || "").trim().toLowerCase();

  let rows: Array<Record<string, unknown>> = [];
  try {
    const { data, error } = await supabase
      .from("agent_knowledge")
      .select("id, content, metadata")
      .eq("shop_id", shop_id)
      .eq("metadata->>audience", "internal")
      .limit(50);
    if (error) {
      console.warn("[internal-rules] fetch error:", error.message);
      return { rules: [], block: "" };
    }
    rows = (data ?? []) as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn("[internal-rules] fetch failed:", err);
    return { rules: [], block: "" };
  }

  const rules: InternalRule[] = [];
  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata as Record<string, unknown>
      : {};
    const triggerIntent = asStringArray(metadata.trigger_intent);
    // No trigger_intent → applies to every intent. Otherwise require overlap.
    const applies = triggerIntent.length === 0 ||
      (intent.length > 0 && triggerIntent.includes(intent));
    if (!applies) continue;

    const content = String(row.content || "").trim();
    if (!content) continue;
    const title = String(metadata.title || metadata.name || metadata.label || "")
      .trim() || "Internal rule";
    rules.push({
      id: String(row.id),
      title,
      content,
      trigger_intent: triggerIntent,
    });
  }

  if (rules.length === 0) return { rules: [], block: "" };

  // Cap to keep the prompt focused — rules with explicit intent triggers are
  // more specific than catch-all rules, so prefer them.
  const ordered = [...rules].sort(
    (a, b) => (b.trigger_intent.length > 0 ? 1 : 0) - (a.trigger_intent.length > 0 ? 1 : 0),
  ).slice(0, 8);

  const block = `# INTERNAL RULES (AUTHORITATIVE — follow them, but NEVER quote them verbatim)
These rules come from the shop's own operations. They determine which PROCEDURE,
ACTION and TERMINOLOGY you must use. They are INTERNAL: translate them into
natural customer language — never copy internal terminology, case types or
department names directly into the customer reply, unless the rule explicitly
says it must be mentioned. If an internal rule conflicts with a KB snippet, the
internal rule wins.

${ordered.map((r, i) => `[rule ${i + 1}] ${r.title}\n${r.content}`).join("\n\n")}`;

  return { rules: ordered, block };
}
