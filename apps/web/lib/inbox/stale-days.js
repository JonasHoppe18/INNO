// Clamp for the per-workspace "auto-resolve inbox tickets with no activity for
// N days" setting. 0 = disabled. Default/global fallback is 7 (matches the
// tick_thread_lifecycle() coalesce default in
// supabase/migrations/20260709120000_needs_attention_stale_resolve.sql).
export const DEFAULT_STALE_DAYS = 7;
export const MIN_STALE_DAYS = 0;
export const MAX_STALE_DAYS = 365;

export function normalizeStaleDays(value) {
  if (value === null || value === undefined) return DEFAULT_STALE_DAYS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_STALE_DAYS;
  const rounded = Math.round(parsed);
  return Math.max(MIN_STALE_DAYS, Math.min(MAX_STALE_DAYS, rounded));
}
