// Soft-disable flags for agent_knowledge rows.
//
// A row is hidden from AI retrieval when ANY of these metadata fields is set:
//   archived        = true   (string "true" or boolean true)
//   disabled_for_ai = true
//   active_for_ai    = false
//
// Defaults are permissive: a missing/unset field keeps the row ACTIVE, so rows
// that carry none of these flags are unaffected. This mirrors the SQL filter in
// match_agent_knowledge (migration 20260617000000) for code paths that query
// agent_knowledge directly and therefore bypass the RPC (BM25 fallback,
// internal-rules audience scan).

function asBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return null;
}

/** True when the row should be EXCLUDED from AI retrieval. */
export function isKnowledgeRowSoftDisabled(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  if (asBool(meta["archived"]) === true) return true;
  if (asBool(meta["disabled_for_ai"]) === true) return true;
  if (asBool(meta["active_for_ai"]) === false) return true;
  return false;
}

/** Convenience: keep only rows that are NOT soft-disabled. */
export function filterSoftDisabledRows<
  T extends { metadata?: Record<string, unknown> | null },
>(rows: T[]): T[] {
  return rows.filter((row) => !isKnowledgeRowSoftDisabled(row.metadata));
}
