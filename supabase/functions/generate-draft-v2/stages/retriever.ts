// supabase/functions/generate-draft-v2/stages/retriever.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { Plan } from "./planner.ts";
import { isVariantConflictingSource } from "./customer-context.ts";

export interface RetrievedChunk {
  id: string;
  content: string;
  kind: string;
  source_label: string;
  similarity: number;
  usable_as:
    | "policy"
    | "procedure"
    | "fact"
    | "saved_reply"
    | "tone_example"
    | "background"
    | "ignore";
  risk_flags: string[];
  // True when this chunk applies to every product in the shop (e.g. a snippet
  // saved in the Product Questions → General bucket). Used by the scorer to
  // skip cross-product penalties and grant a small product-context boost so
  // brand-wide knowledge doesn't drown in noisy product description chunks.
  applies_to_all_products: boolean;
  // Canonical issue_type tags from the snippet metadata (e.g. "pairing",
  // "physical_damage"). Used as an explicit scoring boost when they overlap
  // with the issue terms detected on the customer message — rewards admins
  // who took the time to tag snippets properly.
  chunk_issue_types: string[];
}

export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{
    customer_msg: string;
    agent_reply: string;
    subject: string | null;
    score: number;
    csat_score: number | null;
    conversation_context: string | null;
  }>;
}

export interface RetrieverInput {
  plan: Plan;
  shop_id: string;
  workspace_id?: string | null;
  customerMessage?: string;
  shop?: Record<string, unknown>;
  supabase: SupabaseClient;
  // Eval mode: exclude this ticket's own stored reply from few-shot examples
  // to prevent the model from trivially finding the correct answer in the KB.
  excludeExternalTicketId?: string;
  // Preview mode: exclude specific agent_knowledge chunk ids from retrieval.
  // Used by the "test snippet against ticket" feature to compare a draft with
  // and without a candidate snippet's chunks present in the KB.
  excludeChunkIds?: string[];
}

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!resp.ok) throw new Error(`Embedding error: ${resp.status}`);
  const data = await resp.json();
  return data.data[0].embedding;
}

function sanitiseBm25Query(query: string): string {
  return query
    .replace(/[<>():!&|*\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "could",
  "from",
  "have",
  "hello",
  "help",
  "into",
  "more",
  "need",
  "order",
  "please",
  "that",
  "this",
  "with",
  "would",
  "your",
  "you",
  "jeg",
  "har",
  "det",
  "den",
  "der",
  "kan",
  "med",
  "men",
  "mit",
  "min",
  "mvh",
  "tak",
  "til",
  "ikke",
  "ordrenummer",
]);

const INTENT_TO_ISSUE_TYPES: Record<string, string[]> = {
  tracking: ["tracking", "shipping"],
  return: ["return"],
  refund: ["refund", "return"],
  exchange: ["return", "physical_damage", "connectivity"],
  complaint: ["physical_damage", "connectivity", "audio", "battery", "firmware"],
  product_question: ["product_specs", "connectivity", "audio", "firmware", "battery"],
  address_change: ["shipping"],
  cancel: ["return"],
  other: [],
  thanks: [],
  update: [],
};

function stripHtml(text: string): string {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return stripHtml(text)
    .toLowerCase()
    .replace(/[^a-z0-9æøåäöüßéèáàíóúñ-]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function buildShopProductTerms(shop?: Record<string, unknown>): string[] {
  const overview = String(shop?.product_overview || "");
  const terms = overview
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\s]+/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 80);
  return uniqueStrings(
    terms.flatMap((term) => {
      const lower = term.toLowerCase();
      return lower === "ear pads" ? [lower, "earpads"] : [lower];
    }),
  );
}

function extractMentionedProductTerms(
  text: string,
  shop?: Record<string, unknown>,
): string[] {
  const lower = stripHtml(text).toLowerCase();
  const shopTerms = buildShopProductTerms(shop);
  return shopTerms.filter((term) => {
    if (lower.includes(term)) return true;
    if (term === "ear pads" && lower.includes("earpads")) return true;
    return false;
  });
}

// Output values MUST be from the canonical issue_types vocabulary defined in
// apps/web/lib/knowledge/issue-types.js. The UI tags snippets with these exact
// values, and metadata-overlap scoring depends on them matching. Drift = silent
// retrieval misses.
function extractIssueTerms(text: string): string[] {
  const lower = stripHtml(text).toLowerCase();
  const terms: string[] = [];
  const addIf = (term: string, pattern: RegExp) => {
    if (pattern.test(lower)) terms.push(term);
  };
  addIf("app", /\b(app|ios|android)\b/);
  addIf("pairing", /\b(pair|paired|pairing|parring|parre)\b/);
  addIf(
    "connectivity",
    /\b(connect|connection|forbind|forbinde|tilslut|bluetooth|disconnect)\b/,
  );
  addIf("firmware", /\b(firmware|update|updater|opdater)\b/);
  addIf("factory_reset", /\b(factory reset|reset|nulstil)\b/);
  addIf("audio", /\b(audio|sound|lyd|cable|kabel|usb|usb-c)\b/);
  addIf("microphone", /\b(mic|microphone|mikrofon|mute|unmute)\b/);
  addIf("battery", /\b(battery|batteri|charging|charge|strøm|oplade)\b/);
  addIf("ear_pads", /\b(ear\s*pads?|earpads?|ørepuder?)\b/);
  addIf(
    "physical_damage",
    /\b(damage|damaged|broken|crack|cracked|skade|ødelagt|knækket|broke)\b/,
  );
  addIf(
    "refund",
    /\b(refund|money back|reimbursement|refusion|pengene tilbage)\b/,
  );
  addIf(
    "return",
    /\b(return|retur|swap|replacement|ombytning|warranty|garanti)\b/,
  );
  addIf("tracking", /\b(tracking|track|pakke|shipment|forsendelse|awb)\b/);
  addIf("shipping", /\b(shipping|delivery|fragt|levering|courier|dhl|gls|postnord)\b/);
  addIf("product_specs", /\b(specs?|specifications?|specifikation|dimensions?|weight|vægt)\b/);
  return uniqueStrings(terms);
}

function overlapCount(haystack: string, needles: string[]): number {
  const lower = stripHtml(haystack).toLowerCase();
  return needles.filter((needle) => lower.includes(needle.toLowerCase()))
    .length;
}

function buildFallbackQueries(
  plan: Plan,
  customerMessage?: string,
  shop?: Record<string, unknown>,
): string[] {
  const text = stripHtml(customerMessage || "");
  if (!text) return [];

  const products = extractMentionedProductTerms(text, shop);
  const issues = extractIssueTerms(text);
  const tokens = tokenize(text).slice(0, 18);
  const queries: string[] = [];

  if (products.length || issues.length) {
    queries.push([...products.slice(0, 2), ...issues.slice(0, 3)].join(" "));
  }
  if (issues.includes("ear_pads")) {
    queries.push(
      `${products[0] || ""} ear pads earpads compatible replaceable`.trim(),
    );
  }
  if (plan.primary_intent === "product_question" && products.length) {
    queries.push(`${products[0]} compatibility product specs accessories`);
  }
  if (
    ["complaint", "exchange", "refund"].includes(plan.primary_intent) &&
    products.length
  ) {
    queries.push(`${products[0]} ${issues.join(" ")} warranty troubleshooting`);
  }
  if (tokens.length) queries.push(tokens.join(" "));

  return uniqueStrings(queries).filter((q) => q.length > 3);
}

function sourceLabel(chunk: Record<string, unknown>): string {
  const metadata = chunk.metadata && typeof chunk.metadata === "object"
    ? chunk.metadata as Record<string, unknown>
    : {};
  const title = String(metadata.title || metadata.name || metadata.label || "")
    .trim();
  const provider = String(
    chunk.source_provider ?? chunk.source_type ?? "knowledge",
  );
  return title ? `${provider}: ${title}` : provider;
}

function classifyKnowledgeSource(input: {
  content: string;
  kind: string;
  source_label: string;
  source_provider?: string | null;
  metadata?: Record<string, unknown> | null;
}): Pick<RetrievedChunk, "usable_as" | "risk_flags" | "applies_to_all_products" | "chunk_issue_types"> {
  const provider = String(input.source_provider || "").toLowerCase();
  const kind = String(input.kind || "").toLowerCase();
  const label = String(input.source_label || "").toLowerCase();
  const metadata = input.metadata && typeof input.metadata === "object"
    ? input.metadata
    : {};
  const title = String(metadata.title || metadata.name || "").toLowerCase();
  const content = String(input.content || "");
  const lower = [
    provider,
    kind,
    label,
    title,
    content.slice(0, 1500).toLowerCase(),
  ].join("\n");

  const riskFlags: string[] = [];
  if (
    /\b(full name|full address|email address|order number|phone number|fulde navn|fulde adresse|telefonnummer|ordrenummer|mailadresse)\b/i
      .test(content)
  ) {
    riskFlags.push("asks_for_extra_fields");
  }
  if (
    /\b(known defect|known production|always|never|must|guaranteed|free return|we cover return shipping|fuld refund|altid|aldrig)\b/i
      .test(content)
  ) {
    riskFlags.push("strong_claim");
  }
  if (
    /\b(retailer|forhandler|amazon|power|elgiganten|proshop)\b/i.test(content)
  ) {
    riskFlags.push("retailer_specific");
  }

  let usable_as: RetrievedChunk["usable_as"] = "background";
  if (
    provider === "shopify_policy" ||
    /\b(policy|refund policy|shipping policy|terms|return policy|privacy policy)\b/
      .test(lower)
  ) {
    usable_as = "policy";
  } else if (kind === "saved_reply" || provider === "saved_reply") {
    usable_as = "saved_reply";
  } else if (
    /\b(procedure|script|step-by-step|follow these steps|use this script|return for swap|rma|warranty process)\b/i
      .test(content) ||
    // Numbered step list (e.g. "1. Pack the item.\n2. Print a label.\n3. ...").
    // Catches procedure snippets that don't literally contain the word
    // "procedure" — e.g. AceZone's return guide which is just numbered steps
    // followed by an office address. Without this, such snippets fell through
    // to `background` and the writer refused to use them.
    /(^|\n)\s*\d+[.)]\s/.test(content) ||
    // Postal-address shape — "send the item to" or a clear address block.
    // Same purpose: classify return/RMA address snippets as procedure so
    // the writer treats them as authoritative.
    /\b(send (the |this )?item to|send back to|ship (?:back )?to|return to|return shipping address)\b/i
      .test(content)
  ) {
    usable_as = "procedure";
  } else if (provider === "manual_text") {
    // Admin-curated Q&A snippets from the Knowledge UI are written
    // intentionally as authoritative answers to specific customer questions.
    // Default them to `fact` so the writer treats their content as truth
    // rather than mere "background context". Explicit metadata.usable_as
    // (set further down) still wins if the admin overrode it.
    usable_as = "fact";
  } else if (kind === "ticket") {
    usable_as = "tone_example";
  }

  if (/\b(marketing|newsletter|press release|campaign)\b/.test(lower)) {
    usable_as = "ignore";
  }

  // Explicit classification set by shop admin in KB management UI takes priority over heuristic.
  const VALID_USABLE_AS: RetrievedChunk["usable_as"][] = [
    "policy", "procedure", "fact", "saved_reply", "tone_example", "background", "ignore",
  ];
  const explicitUsableAs = typeof input.metadata?.usable_as === "string"
    ? input.metadata.usable_as as RetrievedChunk["usable_as"]
    : null;
  if (explicitUsableAs && VALID_USABLE_AS.includes(explicitUsableAs)) {
    usable_as = explicitUsableAs;
  }

  // "Applies to all products" — set explicitly when a snippet is saved in
  // Product Questions → General. Also derived for snippets ingested before the
  // flag existed: any manual snippet in product-questions that isn't tied to a
  // product belongs to the general bucket.
  const explicitAppliesToAll = input.metadata?.applies_to_all_products === true;
  const metaCategory = String(input.metadata?.category || "").trim();
  const metaProductId = String(input.metadata?.product_id || "").trim();
  const metaProductsLen = Array.isArray(input.metadata?.products)
    ? (input.metadata?.products as unknown[]).length
    : 0;
  const isManualSnippet = String(input.source_provider || "").toLowerCase() === "manual_text";
  const derivedAppliesToAll =
    isManualSnippet &&
    metaCategory === "product-questions" &&
    !metaProductId &&
    metaProductsLen === 0;
  const applies_to_all_products = explicitAppliesToAll || derivedAppliesToAll;

  const rawIssueTypes = Array.isArray(input.metadata?.issue_types)
    ? (input.metadata?.issue_types as unknown[])
    : [];
  const chunk_issue_types = uniqueStrings(
    rawIssueTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean),
  );

  return {
    usable_as,
    risk_flags: [...new Set(riskFlags)],
    applies_to_all_products,
    chunk_issue_types,
  };
}

function tokenOverlapJaccard(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 ? intersection / union : 0;
}

function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const kept: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const isDuplicate = kept.some(
      (k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6,
    );
    if (!isDuplicate) kept.push(chunk);
  }
  return kept;
}

// Reciprocal Rank Fusion over multiple ranked lists.
// k=60 dampens high-rank advantage.
function rrfFusion(
  lists: Array<Array<Record<string, unknown>>>,
  k = 60,
): Array<{ id: string; score: number; chunk: Record<string, unknown> }> {
  const scores = new Map<
    string,
    { id: string; score: number; chunk: Record<string, unknown> }
  >();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const id = item.id as string;
      const existing = scores.get(id) ?? { id, score: 0, chunk: item };
      existing.score += 1 / (k + rank + 1);
      existing.chunk = item;
      scores.set(id, existing);
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

// Run vector + BM25 for a single query string. Returns two ranked lists.
async function runQueryPair(
  query: string,
  shop_id: string,
  supabase: SupabaseClient,
  filterProducts?: string[],
  filterIssueTypes?: string[],
): Promise<
  {
    vector: Array<Record<string, unknown>>;
    bm25: Array<Record<string, unknown>>;
  }
> {
  const [vectorResult, bm25Result] = await Promise.allSettled([
    (async () => {
      const embedding = await embedText(query);
      const { data, error } = await supabase.rpc("match_agent_knowledge", {
        query_embedding: embedding,
        match_count: 20,
        filter_shop_id: shop_id,
        filter_products: filterProducts?.length ? filterProducts : null,
        filter_issue_types: filterIssueTypes?.length ? filterIssueTypes : null,
      });
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
    (async () => {
      const safeQuery = sanitiseBm25Query(query);
      if (!safeQuery) return [];
      const { data, error } = await supabase
        .from("agent_knowledge")
        .select("id, content, source_type, source_provider, metadata")
        .eq("shop_id", shop_id)
        .neq("source_type", "ticket")
        .neq("source_provider", "saved_reply")
        .textSearch("content", safeQuery, { type: "websearch" })
        .limit(15);
      if (error) {
        console.warn("[retriever] BM25 search error:", error.message);
        return [];
      }
      return (data ?? []) as Array<Record<string, unknown>>;
    })(),
  ]);

  return {
    vector: vectorResult.status === "fulfilled" ? vectorResult.value : [],
    bm25: bm25Result.status === "fulfilled" ? bm25Result.value : [],
  };
}

export async function runRetriever(
  {
    plan,
    shop_id,
    workspace_id,
    customerMessage,
    shop,
    supabase,
    excludeExternalTicketId,
    excludeChunkIds,
  }: RetrieverInput,
): Promise<RetrieverResult> {
  const excludedIdSet = new Set(
    (excludeChunkIds ?? []).map((id) => String(id)).filter(Boolean),
  );
  const queries = uniqueStrings([
    ...plan.sub_queries.filter(Boolean),
    ...buildFallbackQueries(plan, customerMessage, shop),
  ]).slice(0, 5);
  if (queries.length === 0) return { chunks: [], past_ticket_examples: [] };

  const filterProducts = extractMentionedProductTerms(customerMessage || "", shop);
  const intentIssueTypes = INTENT_TO_ISSUE_TYPES[plan.primary_intent] ?? [];
  const detectedIssueTypes = extractIssueTerms(customerMessage || "");
  const filterIssueTypes = uniqueStrings([...intentIssueTypes, ...detectedIssueTypes]);

  // Resolve which ticket_examples ids to exclude (eval data-leakage prevention).
  const excludedTicketExampleIds = new Set<number>();
  if (excludeExternalTicketId) {
    const { data: excludeRows } = await supabase
      .from("ticket_examples")
      .select("id")
      .eq("shop_id", shop_id)
      .eq("external_ticket_id", excludeExternalTicketId);
    for (const row of excludeRows ?? []) {
      if (typeof row.id === "number") excludedTicketExampleIds.add(row.id);
    }
  }

  // Run knowledge queries + ticket lookup in parallel. Saved replies are indexed
  // into agent_knowledge with source_provider='saved_reply', so they use the same
  // metadata/product retrieval path as other knowledge.
  const [queryPairs, ticketResult] = await Promise.all([
    (async () => {
      const filtered = await Promise.all(
        queries.map((q) => runQueryPair(q, shop_id, supabase, filterProducts, filterIssueTypes)),
      );
      const totalHits = filtered.reduce(
        (sum, p) => sum + p.vector.length + p.bm25.length, 0,
      );
      if (totalHits === 0 && (filterProducts.length > 0 || filterIssueTypes.length > 0)) {
        console.log("[retriever] metadata filter returned 0 results — falling back to unfiltered search");
        return Promise.all(queries.map((q) => runQueryPair(q, shop_id, supabase)));
      }
      return filtered;
    })(),
    // Dedicated ticket_examples lookup via own RPC — separate vector index, typed columns
    (async () => {
      try {
        const embeddings = await Promise.all(
          queries.slice(0, 2).map((query) => embedText(query)),
        );
        const intent = plan.primary_intent !== "other"
          ? plan.primary_intent
          : null;
        const resultMap = new Map<
          string,
          {
            customer_msg: string;
            agent_reply: string;
            subject?: string;
            intent?: string;
            csat_score: number | null;
            conversation_context: string | null;
            similarity: number;
            score: number;
          }
        >();

        for (const embedding of embeddings) {
          for (
            const filterIntent of uniqueStrings([
              intent || "",
              "",
            ])
          ) {
            const { data, error } = await supabase.rpc(
              "match_ticket_examples",
              {
                query_embedding: embedding,
                match_count: 5,
                filter_shop_id: shop_id,
                filter_intent: filterIntent || null,
              },
            );
            if (error) {
              console.warn(
                "[retriever] ticket_examples lookup error:",
                error.message,
              );
              continue;
            }

            for (const row of data ?? []) {
              const item = row as {
                id: number;
                customer_msg: string;
                agent_reply: string;
                subject?: string;
                intent?: string;
                csat_score?: number | null;
                conversation_context?: string | null;
                similarity: number;
              };
              const text = `${
                item.subject || ""
              } ${item.customer_msg} ${item.agent_reply}`;
              const queryText = `${queries.join(" ")} ${customerMessage || ""}`;
              const productTerms = extractMentionedProductTerms(
                queryText,
                shop,
              );
              const issueTerms = extractIssueTerms(queryText);
              const lexicalScore = overlapCount(text, productTerms) * 0.12 +
                overlapCount(text, issueTerms) * 0.08;
              // Boost heavily-corrected examples — low csat_score means the shop
              // had to rewrite Sona's draft significantly, making it a richer learning signal.
              const csatScore = typeof item.csat_score === "number" ? item.csat_score : null;
              const correctionBoost = csatScore !== null
                ? ((100 - csatScore) / 100) * 0.15
                : 0;
              const score = Number(item.similarity || 0) + lexicalScore + correctionBoost;
              // Skip tickets that are the source of this eval run
              if (excludedTicketExampleIds.has(item.id)) continue;
              const existing = resultMap.get(String(item.id));
              if (!existing || score > existing.score) {
                resultMap.set(String(item.id), {
                  customer_msg: item.customer_msg,
                  agent_reply: item.agent_reply,
                  subject: item.subject,
                  intent: item.intent,
                  csat_score: csatScore,
                  conversation_context: item.conversation_context ?? null,
                  similarity: item.similarity,
                  score,
                });
              }
            }
          }
        }

        return [...resultMap.values()]
          .filter((item) =>
            item.agent_reply && item.agent_reply.length > 20 &&
            item.score >= 0.45
          )
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((item) => ({
            customer_msg: item.customer_msg,
            agent_reply: item.agent_reply,
            subject: item.subject ?? null,
            score: item.score,
            csat_score: item.csat_score,
            conversation_context: item.conversation_context ?? null,
          }));
      } catch (err) {
        console.warn("[retriever] ticket_examples lookup failed:", err);
        return [];
      }
    })(),
  ]);

  // Fuse knowledge chunks (policies, FAQs, product info) — tickets handled separately
  const allLists: Array<Array<Record<string, unknown>>> = [];
  for (const pair of queryPairs) {
    if (pair.vector.length > 0) allLists.push(pair.vector);
    if (pair.bm25.length > 0) allLists.push(pair.bm25);
  }

  const fusedRaw = rrfFusion(allLists);
  // Drop excluded chunks before any scoring/ranking — used by the snippet
  // preview feature to simulate "what would the AI answer if this snippet
  // wasn't in the knowledge base?"
  const fused = excludedIdSet.size
    ? fusedRaw.filter((r) => !excludedIdSet.has(String(r.id)))
    : fusedRaw;

  // Knowledge chunks include saved replies indexed into agent_knowledge.
  //
  // Budget is intent-aware: complaint/technical_support tickets typically have
  // ONE specific problem (e.g. "headset shuts down randomly"), and sending 4
  // semantically-similar snippets ("powers off", "audio cuts out", "mic
  // doesn't work", "bluetooth workaround") causes the writer to blend them
  // into a generic response instead of using the single best match. Trim to
  // 2 for these intents. Other intents keep the wider context window because
  // returns, refunds, exchanges etc. often legitimately span multiple
  // procedures / policies in one reply.
  const knowledgeBudget =
    plan.primary_intent === "complaint" ||
    plan.primary_intent === "technical_support"
      ? 2
      : 4;
  const queryText = `${queries.join(" ")} ${customerMessage || ""}`;
  const productTerms = extractMentionedProductTerms(queryText, shop);
  const issueTerms = extractIssueTerms(queryText);
  // When exactly one product is mentioned, identify other shop products to penalise
  const mentionedProducts = productTerms.length > 0 ? productTerms : [];
  const allShopProducts = buildShopProductTerms(shop);
  const otherProducts = mentionedProducts.length === 1
    ? allShopProducts.filter((p) => p !== mentionedProducts[0])
    : [];

  const regularChunks: RetrievedChunk[] = fused
    .map((r) => {
      const base = {
        id: r.chunk.id as string,
        content: r.chunk.content as string,
        kind: (r.chunk.source_type as string) ?? "knowledge",
        source_label: sourceLabel(r.chunk),
        similarity: r.score,
      };
      return {
        ...base,
        ...classifyKnowledgeSource({
          ...base,
          source_provider: r.chunk.source_provider as string | null,
          metadata: r.chunk.metadata as Record<string, unknown> | null,
        }),
      };
    })
    .filter((chunk) =>
      !isVariantConflictingSource(customerMessage || "", {
        source_label: chunk.source_label,
        content: chunk.content,
        kind: chunk.kind,
        usable_as: chunk.usable_as,
      })
    )
    .sort((a, b) => {
      const score = (chunk: RetrievedChunk) => {
        const text = `${chunk.source_label} ${chunk.content}`;
        const productBoost = overlapCount(text, mentionedProducts) * 0.10;
        // Cross-product knowledge (Product Questions → General) is by definition
        // compatible with any product, so it should never be penalised for
        // mentioning the "wrong" product and should ride along on the product
        // context when one is present.
        const crossProductPenalty =
          !chunk.applies_to_all_products &&
          mentionedProducts.length === 1 &&
          overlapCount(text, otherProducts) > 0 &&
          overlapCount(text, mentionedProducts) === 0
            ? 0.12
            : 0;
        const generalProductBoost =
          chunk.applies_to_all_products && mentionedProducts.length > 0 ? 0.05 : 0;
        // Reward chunks the admin tagged with issue_types that match what the
        // customer is asking about. This is the explicit metadata path — much
        // more reliable than text overlap once snippets are tagged from the
        // canonical vocabulary.
        const taggedIssueOverlap = chunk.chunk_issue_types.filter((t) =>
          issueTerms.includes(t)
        ).length;
        const taggedIssueBoost = taggedIssueOverlap * 0.06;
        return chunk.similarity +
          productBoost +
          generalProductBoost +
          taggedIssueBoost +
          // Legacy text-overlap boost — still helps for untagged Shopify
          // product descriptions where the issue keyword sometimes appears
          // verbatim. Keep small so tagged chunks win.
          overlapCount(text, issueTerms) * 0.02 +
          (/manual_text|snippet/i.test(`${chunk.source_label} ${chunk.kind}`)
            ? 0.04
            : 0) +
          (chunk.usable_as === "saved_reply" ? 0.06 : 0) +
          (chunk.usable_as === "policy" ? 0.02 : 0) +
          (chunk.usable_as === "fact" ? 0.02 : 0) -
          crossProductPenalty;
      };
      return score(b) - score(a);
    })
    // Deduplicate near-identical chunks before applying budget
    .reduce((acc: RetrievedChunk[], chunk) => {
      const isDuplicate = acc.some(
        (k) => tokenOverlapJaccard(k.content, chunk.content) >= 0.6,
      );
      return isDuplicate ? acc : [...acc, chunk];
    }, [])
    // Only include chunks that clear a minimum relevance floor relative to the top score
    .filter((chunk, _i, arr) => {
      if (arr.length === 0) return true;
      const topSimilarity = arr[0].similarity;
      // Always include at least 3 results; after that require >= 60% of top score
      return _i < 3 || chunk.similarity >= topSimilarity * 0.6;
    })
    .slice(0, knowledgeBudget);

  // ---- Q&A title-match override ----
  // If exactly one Q&A snippet's question/title has dominant lexical overlap
  // with the customer message, it is almost certainly THE answer — narrow the
  // chunks list to just that snippet so the writer can't be distracted by
  // semantically-similar siblings. Example: customer asks "headset shuts down
  // randomly", we have one snippet titled "Bluetooth - Workaround for
  // interrupted shutdown process" and three others about audio/mic/earcup
  // issues. Embedding similarity puts them all close; this lexical check
  // picks the clear winner.
  //
  // Threshold: overlap >= 0.35 AND at least 1.6x higher than the runner-up.
  // 0.35 is high enough to require real word overlap (not just "the/a")
  // since tokenize() strips stop words and we use Jaccard over content words.
  if (regularChunks.length >= 2 && customerMessage) {
    const customerTokens = new Set(tokenize(customerMessage));
    if (customerTokens.size >= 2) {
      const titleScores = regularChunks.map((chunk) => {
        const meta = (chunk as unknown as { metadata?: Record<string, unknown> }).metadata;
        const title = String(
          (meta as Record<string, unknown> | undefined)?.title ||
            (meta as Record<string, unknown> | undefined)?.question ||
            chunk.source_label ||
            "",
        ).replace(/^[^:]+:\s*/, ""); // strip "manual_text: " prefix
        const titleTokens = new Set(tokenize(title));
        if (titleTokens.size === 0) return { chunk, score: 0 };
        const intersection = [...customerTokens].filter((t) =>
          titleTokens.has(t)
        ).length;
        // Coverage of the title by the customer's words — i.e. how much of
        // the snippet's question is reflected in the customer's email.
        const score = intersection / titleTokens.size;
        return { chunk, score };
      }).sort((a, b) => b.score - a.score);

      const winner = titleScores[0];
      const runnerUp = titleScores[1];
      if (
        winner.score >= 0.35 &&
        (runnerUp.score === 0 || winner.score >= runnerUp.score * 1.6)
      ) {
        console.log(
          `[retriever] Q&A title-match override → using single chunk: ${winner.chunk.source_label} (score=${winner.score.toFixed(2)}, runner-up=${runnerUp.score.toFixed(2)})`,
        );
        regularChunks.length = 0;
        regularChunks.push(winner.chunk);
      }
    }
  }

  // Past ticket examples — directly from typed ticket_examples table
  const pastTicketExamples = ticketResult
    .filter((t) => t.agent_reply && t.agent_reply.length > 20)
    .map((t) => ({
      customer_msg: t.customer_msg,
      agent_reply: t.agent_reply,
      subject: t.subject ?? null,
      score: t.score,
      csat_score: t.csat_score ?? null,
      conversation_context: t.conversation_context ?? null,
    }));

  console.log(
    `[retriever] queries=${queries.length} knowledge=${regularChunks.length} saved_reply_knowledge=${
      regularChunks.filter((chunk) => chunk.usable_as === "saved_reply").length
    } past_tickets=${pastTicketExamples.length}`,
  );

  return {
    chunks: regularChunks,
    past_ticket_examples: pastTicketExamples,
  };
}
