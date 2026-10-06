// A1: centralized Knowledge V2 authorization.
//
// Every Knowledge V2 mutation runs server-side with the service role, so RLS
// does not protect writes. Every route must resolve its context here:
//   1. authenticated Clerk principal,
//   2. workspace membership (org:admin and org:member both hold every merchant
//      Knowledge capability),
//   3. shop resolved from that authorized workspace,
// and must then write only server-derived workspace_id/shop_id.

export const MERCHANT_KNOWLEDGE_CAPABILITIES = Object.freeze([
  "knowledge.read",
  "knowledge.source.capture",
  "knowledge.draft.edit",
  "knowledge.review.answer",
  "knowledge.binding.approve",
  "knowledge.publish",
  "knowledge.activate",
  "knowledge.rollback",
  "knowledge.platform_migration.approve",
]);

// Sona-only capabilities are granted by Sona role, never by workspace role.
export const SONA_KNOWLEDGE_CAPABILITIES = Object.freeze({
  "knowledge.review.statutory_resolve": "sona_legal",
  "knowledge.platform_migration.prepare": "sona_ops",
});

const SONA_ROLES = new Set(["sona_legal", "sona_ops"]);

export class KnowledgeAuthzError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "KnowledgeAuthzError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeWorkspaceRole(role) {
  const value = String(role ?? "").trim().toLowerCase();
  if (value === "org:admin" || value === "admin") return "admin";
  if (value === "org:member" || value === "member") return "member";
  return null;
}

// Sona roles require both the principal's Clerk metadata claim and the
// server-side allowlist (e.g. parsed from a server env var).
export function resolveSonaRoles({ clerkUserId, publicMetadata, allowlist }) {
  const claimed = Array.isArray(publicMetadata?.sona_roles) ? publicMetadata.sona_roles : [];
  const allowed = new Set(Array.isArray(allowlist?.[clerkUserId]) ? allowlist[clerkUserId] : []);
  return claimed.filter((role) => SONA_ROLES.has(role) && allowed.has(role));
}

async function loadShop(supabase, shopId) {
  const { data, error } = await supabase
    .from("shops")
    .select("id, workspace_id")
    .eq("id", shopId)
    .maybeSingle();
  if (error) throw new KnowledgeAuthzError(500, "lookup_failed", "Shop lookup failed.");
  return data ?? null;
}

// Returns a frozen context: { principal, clerkUserId, workspaceId, shopId, role, capability }.
// requestedShopId is only a selector; it is honored only inside an authorized workspace.
export async function resolveKnowledgeContext({ supabase, clerkUserId, capability, requestedShopId = null, sonaRoles = [] }) {
  if (!clerkUserId) throw new KnowledgeAuthzError(401, "unauthenticated", "Authentication required.");

  const sonaRole = SONA_KNOWLEDGE_CAPABILITIES[capability];
  if (!sonaRole && !MERCHANT_KNOWLEDGE_CAPABILITIES.includes(capability)) {
    throw new KnowledgeAuthzError(400, "unknown_capability", `Unknown capability ${capability}.`);
  }

  if (sonaRole) {
    if (!sonaRoles.includes(sonaRole)) throw new KnowledgeAuthzError(403, "forbidden", "This action requires a Sona role.");
    if (!requestedShopId) throw new KnowledgeAuthzError(400, "shop_required", "A shop must be selected.");
    const shop = await loadShop(supabase, requestedShopId);
    if (!shop?.workspace_id) throw new KnowledgeAuthzError(404, "not_found", "Shop not found.");
    return Object.freeze({ principal: "sona", clerkUserId, workspaceId: shop.workspace_id, shopId: shop.id, role: sonaRole, capability });
  }

  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("clerk_user_id", clerkUserId);
  if (error) throw new KnowledgeAuthzError(500, "lookup_failed", "Membership lookup failed.");
  const roleByWorkspace = new Map();
  for (const membership of memberships ?? []) {
    const role = normalizeWorkspaceRole(membership.role);
    if (role && membership.workspace_id) roleByWorkspace.set(membership.workspace_id, role);
  }
  if (roleByWorkspace.size === 0) throw new KnowledgeAuthzError(403, "forbidden", "No workspace access.");

  let shop;
  if (requestedShopId) {
    shop = await loadShop(supabase, requestedShopId);
    // Same response for "missing" and "other tenant": never reveal foreign shops.
    if (!shop || !roleByWorkspace.has(shop.workspace_id)) throw new KnowledgeAuthzError(404, "not_found", "Shop not found.");
  } else {
    const { data: shops, error: shopsError } = await supabase
      .from("shops")
      .select("id, workspace_id")
      .in("workspace_id", [...roleByWorkspace.keys()]);
    if (shopsError) throw new KnowledgeAuthzError(500, "lookup_failed", "Shop lookup failed.");
    if (!shops?.length) throw new KnowledgeAuthzError(404, "not_found", "No shop in your workspace.");
    if (shops.length > 1) throw new KnowledgeAuthzError(409, "shop_selection_required", "Select a shop.");
    shop = shops[0];
  }

  return Object.freeze({
    principal: "merchant",
    clerkUserId,
    workspaceId: shop.workspace_id,
    shopId: shop.id,
    role: roleByWorkspace.get(shop.workspace_id),
    capability,
  });
}

// Runtime (system principal) context for resolution writing. The shop comes from
// a server-verified source (e.g. the inbound route); the workspace is always read
// from the shop row, never taken from the caller.
export async function resolveRuntimeKnowledgeContext({ supabase, shopId }) {
  if (!shopId) throw new KnowledgeAuthzError(400, "shop_required", "A server-verified shop is required.");
  const shop = await loadShop(supabase, shopId);
  if (!shop?.workspace_id) throw new KnowledgeAuthzError(404, "not_found", "Shop not found.");
  return Object.freeze({
    principal: "system",
    clerkUserId: null,
    workspaceId: shop.workspace_id,
    shopId: shop.id,
    role: "system",
    capability: "knowledge.resolve",
  });
}

// Stamps server-derived tenant ids on a row. Client-supplied tenant ids that
// disagree with the authorized context are rejected, never silently used.
export function bindTenant(context, row) {
  for (const [key, expected] of [["workspace_id", context.workspaceId], ["shop_id", context.shopId]]) {
    if (row?.[key] !== undefined && row[key] !== null && row[key] !== expected) {
      throw new KnowledgeAuthzError(400, "tenant_mismatch", `Client-supplied ${key} does not match the authorized context.`);
    }
  }
  return { ...row, workspace_id: context.workspaceId, shop_id: context.shopId };
}
