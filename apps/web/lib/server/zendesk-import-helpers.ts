// Pure helpers for the full-history Zendesk import. No I/O.

// One-time cost model per ticket (July 2026 list prices):
// - redaction: gpt-4o-mini, ~700 input + ~500 output tokens
//   ($0.15/1M in, $0.60/1M out) => ~$0.000405/ticket
// - embedding: text-embedding-3-small, ~400 tokens ($0.02/1M) => ~$0.000008
// Total: ~$0.000413/ticket. Rounded to 0.0004 (<3% variance) so that 2-decimal
// display rounding remains exactly linear in tests — this is a coarse pre-run estimate,
// not billing.
const USD_PER_TICKET = 0.0004;
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

export function nextExportCursor(input: {
  statuses: string[];
  cursor: { status: string; after: string | null };
  hasMore: boolean;
  afterCursor: string | null;
  now?: string;
}): { status: string; after: string | null; after_created_at?: string } | null {
  if (input.hasMore && input.afterCursor) {
    return {
      status: input.cursor.status,
      after: input.afterCursor,
      after_created_at: input.now ?? new Date().toISOString(),
    };
  }
  const index = input.statuses.indexOf(input.cursor.status);
  if (index < 0 || index >= input.statuses.length - 1) return null;
  return { status: input.statuses[index + 1], after: null };
}

export function isRetryableImportStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - now);
}

export function importRetryDelayMs(input: {
  attempt: number;
  retryAfterMs?: number | null;
}): number {
  const attempt = Math.max(0, Math.floor(input?.attempt ?? 0));
  const exponential = Math.min(12_000, 750 * 2 ** attempt);
  return Math.max(exponential, Math.min(15_000, input?.retryAfterMs ?? 0));
}
