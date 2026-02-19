
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { resolveShopId } from "@/lib/server/shops";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

function stripHtml(value = "") {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.user_id) throw new Error("Supabase user not found for this Clerk user.");
  return data.user_id;
}

async function fetchShopifyCredentials(serviceClient, ownerUserId) {
  const { data, error } = await serviceClient
    .from("shops")
    .select("shop_domain, access_token_encrypted")
    .eq("owner_user_id", ownerUserId)
    .eq("platform", "shopify")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.shop_domain || !data?.access_token_encrypted) {
    throw new Error("Missing Shopify credentials.");
  }
  return {
    shop_domain: data.shop_domain,
    access_token: decryptString(data.access_token_encrypted),
  };
}

async function fetchShopifyProducts({ domain, accessToken }) {
  const products = [];
  let pageInfo = null;
  const limit = 50;
  for (let i = 0; i < 5; i++) {
    const url = new URL(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/products.json`);
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", String(limit));
    if (pageInfo) url.searchParams.set("page_info", pageInfo);
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Shopify products returned ${res.status}`);
    }
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.products) ? payload.products : [];
    products.push(...items);
    const linkHeader = res.headers.get("link") ?? "";
    const next = extractNextPageInfo(linkHeader);
    if (!next) break;
    pageInfo = next;
  }
  return products;
}

function extractNextPageInfo(linkHeader = "") {
  const parts = linkHeader.split(",");
  for (const part of parts) {
    if (part.includes('rel="next"')) {
      const match = part.match(/<([^>]+)>/);
      if (!match?.[1]) continue;
      try {
        const url = new URL(match[1]);
        return url.searchParams.get("page_info");
      } catch {
        continue;
      }
    }
  }
  return null;
}

async function embedText(text) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing.");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: OPENAI_EMBEDDING_MODEL,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message || `OpenAI returned ${res.status}`;
    throw new Error(message);
  }
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("Embedding not returned.");
  return vector;
}

async function syncShopify({ supabaseUserId, shopRefId, serviceClient }) {
  const creds = await fetchShopifyCredentials(serviceClient, supabaseUserId);
  const domain = creds.shop_domain.replace(/^https?:\/\//, "");
  const products = await fetchShopifyProducts({ domain, accessToken: creds.access_token });

  const rows = [];
  for (const product of products) {
    const title = product?.title ?? "Untitled product";
    const descriptionRaw =
      product?.body_html || product?.body || product?.description || product?.body_text || "";
    const description = stripHtml(descriptionRaw);
    const variant = Array.isArray(product?.variants) ? product.variants[0] : null;
    const price = variant?.price ?? variant?.compare_at_price ?? "";
    const context = `Product: ${title}. Price: ${price || "N/A"}. Details: ${description || "No details."}`;
    const embedding = await embedText(context);
    rows.push({
      shop_ref_id: shopRefId,
      external_id: String(product?.id ?? ""),
      platform: "shopify",
      title,
      description,
      price: price || null,
      embedding,
    });
  }

  if (rows.length) {
    const { error } = await serviceClient.from("shop_products").upsert(rows, {
      onConflict: "shop_ref_id,external_id,platform",
    });
    if (error) {
      if (error.code === "42P10") {
        throw new Error(
          `${error.message}. Missing unique constraint for shop_products upsert. ` +
            "TODO SQL: create unique index if not exists shop_products_shop_ref_external_platform_idx " +
            "on public.shop_products(shop_ref_id, external_id, platform);",
        );
      }
      throw new Error(error.message);
    }
  }

  return { synced: rows.length };
}

export async function POST() {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Supabase service key missing" }, { status: 500 });
  }

  const serviceClient = createServiceClient();
  try {
    const supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
    const shopRefId = await resolveShopId(serviceClient, { ownerUserId: supabaseUserId });
    const result = await syncShopify({ supabaseUserId, shopRefId, serviceClient });
    return NextResponse.json({ success: true, platform: "shopify", ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
