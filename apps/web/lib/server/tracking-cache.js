const DEFAULT_TTL_MS = 60 * 60 * 1000;

export function normalizeTrackingNumber(value) {
  return String(value || "").replace(/[\s-]+/g, "").trim().toUpperCase();
}

export function friendlyTrackingCacheDbError(error) {
  const message = String(error?.message || error || "");
  const code = String(error?.code || "").toUpperCase();
  if (
    message.includes("tracking_snapshots") &&
    (
      message.includes("schema cache") ||
      message.includes("Could not find the table") ||
      message.includes("does not exist") ||
      code === "42P01" ||
      code === "PGRST205"
    )
  ) {
    return "Tracking cache is not set up yet. Run the migration before caching tracking snapshots.";
  }
  return message || "Tracking cache request failed.";
}

export function isMissingTrackingCacheTableError(error) {
  return friendlyTrackingCacheDbError(error).startsWith("Tracking cache is not set up yet.");
}

function lower(value) {
  return String(value || "").toLowerCase();
}

export function deriveTrackingStatus(detail = {}) {
  const snapshot = detail?.snapshot || {};
  const statusCode = lower(snapshot?.statusCode || detail?.carrierStatus || "");
  const statusText = lower(detail?.statusText || snapshot?.statusText || snapshot?.lastEvent?.description || "");
  const lookupDetail = lower(detail?.lookupDetail || "");

  if (lookupDetail.startsWith("api_failed") || lookupDetail === "request_error") return "lookup_error";
  if (statusCode.includes("returned")) return "returned_to_sender";
  if (statusCode.includes("delivered") || statusText.includes("delivered") || statusText.includes("leveret")) {
    return "delivered";
  }
  if (statusCode.includes("out_for_delivery") || statusText.includes("out for delivery")) return "out_for_delivery";
  if (statusCode.includes("pickup") || statusText.includes("pickup") || statusText.includes("afhent")) return "pickup_ready";
  if (statusCode.includes("transit") || statusText.includes("transit") || statusText.includes("på vej")) return "in_transit";
  if (statusCode.includes("label") || statusText.includes("registered") || statusText.includes("expecting")) return "label_created";
  if (statusCode.includes("exception") || statusText.includes("exception") || statusText.includes("failed")) return "exception";
  if (statusCode.includes("pending") || statusText.includes("pending")) return "pending";
  return "unknown";
}

export function ttlForTrackingStatus(status = "unknown") {
  switch (String(status || "unknown")) {
    case "delivered":
    case "returned_to_sender":
      return 30 * 24 * 60 * 60 * 1000;
    case "out_for_delivery":
      return 20 * 60 * 1000;
    case "in_transit":
    case "pickup_ready":
      return 45 * 60 * 1000;
    case "label_created":
    case "pending":
    case "unknown":
      return 3 * 60 * 60 * 1000;
    case "lookup_error":
    case "exception":
      return 30 * 60 * 1000;
    default:
      return DEFAULT_TTL_MS;
  }
}

export function isTrackingCacheFresh(row, now = new Date()) {
  if (!row?.last_checked_at) return false;
  const checkedAt = Date.parse(row.last_checked_at);
  if (!Number.isFinite(checkedAt)) return false;
  return now.getTime() - checkedAt < ttlForTrackingStatus(row.status);
}

export function trackingCacheRowToDetail(row) {
  if (!row) return null;
  return {
    carrier: row.carrier || "Carrier",
    statusText: row.status_text || "Tracking status available.",
    trackingNumber: row.tracking_number || row.normalized_tracking_number || "",
    trackingUrl: row.tracking_url || "",
    lookupSource: row.lookup_source || "tracking_cache",
    lookupDetail: row.lookup_detail || "cached",
    snapshot: row.tracking_snapshot || null,
  };
}

export async function resolveTrackingWorkspaceId(serviceClient, scope, threadId) {
  if (scope?.workspaceId && !threadId) return scope.workspaceId;
  const id = String(threadId || "").trim();
  if (!id) return scope?.workspaceId || null;

  let query = serviceClient
    .from("mail_threads")
    .select("id, workspace_id, user_id")
    .eq("id", id)
    .limit(1);
  if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
  else if (scope?.supabaseUserId) query = query.eq("user_id", scope.supabaseUserId);

  const { data, error } = await query.maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return data?.workspace_id || scope?.workspaceId || null;
}

export async function getCachedTrackingSnapshot(serviceClient, { workspaceId, trackingNumber }) {
  const workspace = String(workspaceId || "").trim();
  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!workspace || !normalized) return { row: null, unavailable: false };

  const { data, error } = await serviceClient
    .from("tracking_snapshots")
    .select("*")
    .eq("workspace_id", workspace)
    .eq("normalized_tracking_number", normalized)
    .maybeSingle();
  if (error) {
    if (isMissingTrackingCacheTableError(error)) return { row: null, unavailable: true };
    throw Object.assign(new Error(friendlyTrackingCacheDbError(error)), { status: 500 });
  }
  return { row: data || null, unavailable: false };
}

export async function upsertTrackingSnapshot(
  serviceClient,
  { workspaceId, trackingNumber, trackingUrl = "", company = "", direction = "unknown", detail = {} },
) {
  const workspace = String(workspaceId || "").trim();
  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!workspace || !normalized || !detail) return { row: null, unavailable: false };

  const snapshot = detail?.snapshot || {};
  const status = deriveTrackingStatus(detail);
  const row = {
    workspace_id: workspace,
    tracking_number: String(detail?.trackingNumber || trackingNumber || "").trim() || normalized,
    normalized_tracking_number: normalized,
    carrier: String(detail?.carrier || company || "").trim() || null,
    tracking_url: String(detail?.trackingUrl || trackingUrl || "").trim() || null,
    direction,
    status,
    status_text: String(detail?.statusText || snapshot?.statusText || "").trim() || null,
    tracking_snapshot: snapshot && typeof snapshot === "object" ? snapshot : {},
    lookup_source: String(detail?.lookupSource || "").trim() || null,
    lookup_detail: String(detail?.lookupDetail || "").trim() || null,
    last_checked_at: new Date().toISOString(),
    delivered_at: snapshot?.deliveredAt || (status === "delivered" ? snapshot?.lastEvent?.occurredAt || null : null),
  };

  const { data, error } = await serviceClient
    .from("tracking_snapshots")
    .upsert(row, { onConflict: "workspace_id,normalized_tracking_number" })
    .select("*")
    .maybeSingle();
  if (error) {
    if (isMissingTrackingCacheTableError(error)) return { row: null, unavailable: true };
    throw Object.assign(new Error(friendlyTrackingCacheDbError(error)), { status: 500 });
  }
  return { row: data || null, unavailable: false };
}
