import { createClient } from "jsr:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

interface GenerateIssueMetadataParams {
  supabase: SupabaseClient;
  workspaceId: string;
  threadId: string;
  subject: string;
  body: string;
  openaiApiKey: string;
}

interface ParsedMetadata {
  issue_summary: string | null;
  detected_product_id: string | null;
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

async function callOpenAI(apiKey: string, messages: object[]): Promise<string> {
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export function parseIssueMetadataResponse(
  raw: string,
  validProductIds: Set<string>,
): ParsedMetadata {
  try {
    const parsed = JSON.parse(raw);
    const issue_summary =
      typeof parsed.issue_summary === "string" && parsed.issue_summary.trim()
        ? parsed.issue_summary.trim().slice(0, 500)
        : null;
    // Accept both string and number (shop_products.id is bigint)
    const rawId = parsed.detected_product_id;
    const idStr = rawId != null ? String(rawId) : null;
    const detected_product_id = idStr && validProductIds.has(idStr) ? idStr : null;
    return { issue_summary, detected_product_id };
  } catch {
    return { issue_summary: null, detected_product_id: null };
  }
}

export async function generateIssueMetadata(
  params: GenerateIssueMetadataParams,
): Promise<void> {
  const { supabase, workspaceId, threadId, subject, body, openaiApiKey } = params;

  // Skip if already populated (avoid re-generating on reply threads)
  // deno-lint-ignore no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("mail_threads")
    .select("issue_summary")
    .eq("id", threadId)
    .maybeSingle();
  if (existing?.issue_summary) return;

  // Resolve the internal shop UUID from workspace_id
  // deno-lint-ignore no-explicit-any
  const { data: shop } = await (supabase as any)
    .from("shops")
    .select("id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  let products: { id: string; title: string }[] = [];
  if (shop?.id) {
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any)
      .from("shop_products")
      .select("id, title")
      .eq("shop_ref_id", shop.id)
      .limit(50);
    products = data ?? [];
  }

  const productList = products
    .map((p: { id: string; title: string }) => `- ID: ${p.id} | Name: "${p.title}"`)
    .join("\n");

  const ticketContent = `Subject: ${subject || "(none)"}\n\n${(body || "").slice(0, 1500)}`;

  const productInstruction = productList
    ? `- "detected_product_id": The ID of the product from the list below that is mentioned in the ticket, or null if none matches clearly.\n\nAvailable products:\n${productList}`
    : '- "detected_product_id": null';

  const systemPrompt =
    `You are a support ticket analyzer. Given a support ticket, return JSON with:\n` +
    `- "issue_summary": 1-2 English sentences describing what the customer wants or what the problem is. Be specific and concise.\n` +
    productInstruction;

  const raw = await callOpenAI(openaiApiKey, [
    { role: "system", content: systemPrompt },
    { role: "user", content: ticketContent },
  ]);

  // Use String() to normalise bigint IDs from Postgres to strings for Set lookup
  const validProductIds = new Set(products.map((p: { id: unknown }) => String(p.id)));
  const { issue_summary, detected_product_id } = parseIssueMetadataResponse(raw, validProductIds);

  const updates: Record<string, string | null> = {};
  if (issue_summary) updates.issue_summary = issue_summary;
  if (detected_product_id) updates.detected_product_id = detected_product_id;

  if (Object.keys(updates).length) {
    // deno-lint-ignore no-explicit-any
    await (supabase as any).from("mail_threads").update(updates).eq("id", threadId);
  }
}
