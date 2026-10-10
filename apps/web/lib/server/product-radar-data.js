import { applyScope } from "@/lib/server/workspace-auth";
import { RADAR_RULES, buildProductRadar, isSupportThread } from "@/lib/server/product-radar";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// PostgREST caps a response at 1000 rows; larger shops need several pages.
const PAGE_SIZE = 1000;
const PRODUCT_TICKET_LIMIT = 50;
const THREAD_COLUMNS =
  "id, ticket_number, subject, status, classification_key, tags, detected_product_id, issue_summary, created_at";

async function fetchRadarThreads(serviceClient, scope, since, until) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = serviceClient
      .from("mail_threads")
      .select(THREAD_COLUMNS)
      .gte("created_at", since)
      .lt("created_at", until)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    query = applyScope(query, scope);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function fetchProductTitles(serviceClient, productIds) {
  const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await serviceClient.from("shop_products").select("id, title").in("id", ids);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((row) => [String(row.id), row.title]));
}

function toProductTicket(thread) {
  return {
    id: thread.id,
    ticketNumber: thread.ticket_number ?? null,
    subject: thread.subject || null,
    status: thread.status || null,
    issueSummary: thread.issue_summary || null,
    createdAt: thread.created_at,
    url: `/inbox?thread=${encodeURIComponent(thread.id)}`,
  };
}

// Loads the radar for the scoped workspace. With `productId`, also returns that
// product's tickets from the shown window, newest first.
export async function loadProductRadar(serviceClient, scope, { now = new Date(), productId = null } = {}) {
  const nowMs = new Date(now).getTime();
  const historyWeeks = RADAR_RULES.weeks + RADAR_RULES.risingConfirmWeeks - 1;
  const since = new Date(nowMs - historyWeeks * WEEK_MS).toISOString();
  const until = new Date(nowMs).toISOString();

  const threads = await fetchRadarThreads(serviceClient, scope, since, until);
  const productMap = await fetchProductTitles(serviceClient, threads.map((thread) => thread.detected_product_id));
  const radar = buildProductRadar({ threads, productMap, now: nowMs });

  const result = {
    generatedAt: until,
    weeks: RADAR_RULES.weeks,
    ...radar,
  };
  if (!productId) return result;

  const shownSinceMs = nowMs - RADAR_RULES.weeks * WEEK_MS;
  const product = radar.products.find((row) => row.productId === String(productId)) || null;
  const tickets = product
    ? threads
      .filter((thread) => String(thread.detected_product_id || "") === product.productId)
      .filter((thread) => new Date(thread.created_at).getTime() >= shownSinceMs && isSupportThread(thread))
      .slice(0, PRODUCT_TICKET_LIMIT)
      .map(toProductTicket)
    : [];
  return { ...result, product, tickets };
}
