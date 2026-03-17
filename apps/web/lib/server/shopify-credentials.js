import crypto from "node:crypto";
import { decryptString } from "@/lib/server/shopify-oauth";
import { applyScope } from "@/lib/server/workspace-auth";

function normalizeShopDomain(value = "") {
  return String(value || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

function fingerprintToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex").slice(0, 16);
}

function sanitizeShopRow(row) {
  if (!row) return null;
  return {
    id: row.id ?? null,
    shop_domain: row.shop_domain ?? null,
    workspace_id: row.workspace_id ?? null,
    shopify_client_id: row.shopify_client_id ?? null,
    installed_at: row.installed_at ?? null,
    updated_at: row.updated_at ?? null,
    created_at: row.created_at ?? null,
    uninstalled_at: row.uninstalled_at ?? null,
    has_access_token: Boolean(row.access_token_encrypted),
  };
}

export async function resolveShopifyCredentialsWithDiagnostics(serviceClient, scope, {
  requestedShopId = "",
  requestedShopDomain = "",
  reason = "shopify_credentials",
  log = console.info,
} = {}) {
  const normalizedShopId = String(requestedShopId || "").trim();
  const normalizedDomain = normalizeShopDomain(requestedShopDomain);

  let candidateQuery = serviceClient
    .from("shops")
    .select(
      "id, shop_domain, workspace_id, shopify_client_id, access_token_encrypted, installed_at, updated_at, created_at, uninstalled_at, platform",
    )
    .eq("platform", "shopify")
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);
  candidateQuery = applyScope(candidateQuery, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "owner_user_id",
  });
  if (normalizedShopId) {
    candidateQuery = candidateQuery.eq("id", normalizedShopId);
  } else if (normalizedDomain) {
    candidateQuery = candidateQuery.eq("shop_domain", normalizedDomain);
  } else {
    candidateQuery = candidateQuery.is("uninstalled_at", null);
  }

  const { data: candidateRows, error: candidateError } = await candidateQuery;
  if (candidateError) {
    throw new Error(candidateError.message);
  }

  const candidates = Array.isArray(candidateRows) ? candidateRows : [];
  log(JSON.stringify({
    event: "shopify.credentials.candidates",
    reason,
    requested_shop_id: normalizedShopId || null,
    requested_shop_domain: normalizedDomain || null,
    candidate_rows: candidates.map(sanitizeShopRow),
  }));

  let selected = null;
  if (normalizedShopId) {
    selected = candidates.find((row) => String(row?.id || "") === normalizedShopId) ?? null;
  } else if (normalizedDomain) {
    selected = candidates.find((row) => normalizeShopDomain(row?.shop_domain) === normalizedDomain) ?? null;
  } else {
    selected = candidates.find((row) => row?.uninstalled_at == null) ?? candidates[0] ?? null;
  }

  if (!selected) {
    throw new Error("Shop not found in current scope.");
  }
  if (!selected.access_token_encrypted) {
    throw new Error("Missing Shopify access token for selected shop.");
  }

  const accessToken = decryptString(selected.access_token_encrypted);
  const tokenFingerprint = fingerprintToken(accessToken);
  const selectedRow = sanitizeShopRow(selected);

  log(JSON.stringify({
    event: "shopify.credentials.selected",
    reason,
    selected_row: selectedRow,
    token_source: "db",
    token_fingerprint: tokenFingerprint,
  }));

  return {
    row: selected,
    selected_row: selectedRow,
    candidates: candidates.map(sanitizeShopRow),
    shop_id: selected.id,
    shop_domain: normalizeShopDomain(selected.shop_domain),
    shopify_client_id: selected.shopify_client_id ?? null,
    access_token: accessToken,
    token_fingerprint: tokenFingerprint,
  };
}
