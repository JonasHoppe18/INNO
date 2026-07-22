// Self-healing product-webhook registration. Ported from the Deno-side
// registerShopUpdateWebhook pattern in supabase/functions/shopify-connect/index.ts
// (create → 422 means it already exists → list + update address if it moved),
// parameterized over a topic list so it can cover products/create|update|delete.
// Never throws — a webhook-registration failure must not abort a product sync.

export const PRODUCT_WEBHOOK_TOPICS = [
  "products/create", "products/update", "products/delete",
];

export const ANALYTICS_WEBHOOK_TOPICS = [
  "orders/create", "orders/updated", "refunds/create",
];

export const COMMERCE_WEBHOOK_TOPICS = [
  ...PRODUCT_WEBHOOK_TOPICS,
  ...ANALYTICS_WEBHOOK_TOPICS,
];

async function ensureOneWebhook({ apiBase, headers, topic, address }) {
  const createRes = await fetch(`${apiBase}/webhooks.json`, {
    method: "POST", headers,
    body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
  });
  if (createRes.ok || createRes.status === 201) return;
  if (createRes.status !== 422) return; // best-effort: log-less skip on other errors
  const listRes = await fetch(`${apiBase}/webhooks.json?topic=${encodeURIComponent(topic)}`, { headers });
  if (!listRes.ok) return;
  const listData = await listRes.json().catch(() => null);
  const existing = (listData?.webhooks ?? []).find((w) => w.topic === topic);
  if (!existing || existing.address === address) return;
  await fetch(`${apiBase}/webhooks/${existing.id}.json`, {
    method: "PUT", headers,
    body: JSON.stringify({ webhook: { address } }),
  });
}

export async function ensureShopifyWebhooks({ domain, accessToken, apiVersion, appUrl, topics }) {
  if (!appUrl) return;
  const apiBase = `https://${domain}/admin/api/${apiVersion}`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const address = `${appUrl.replace(/\/$/, "")}/api/webhooks/shopify`;
  for (const topic of topics) {
    try { await ensureOneWebhook({ apiBase, headers, topic, address }); }
    catch (_e) { /* non-fatal */ }
  }
}
