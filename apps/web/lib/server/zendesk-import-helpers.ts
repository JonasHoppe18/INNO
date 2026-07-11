// Pure helpers for the full-history Zendesk import. No I/O.

// One-time cost model per ticket (July 2026 list prices):
// - redaction: gpt-4o-mini, ~700 input + ~500 output tokens
//   ($0.15/1M in, $0.60/1M out) => ~$0.000405/ticket
// - embedding: text-embedding-3-small, ~400 tokens ($0.02/1M) => ~$0.000008
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
