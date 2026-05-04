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
    | "saved_reply"
    | "tone_example"
    | "background"
    | "ignore";
  risk_flags: string[];
}

export interface RetrieverResult {
  chunks: RetrievedChunk[];
  past_ticket_examples: Array<{ customer_msg: string; agent_reply: string }>;
}

export interface RetrieverInput {
  plan: Plan;
  shop_id: string;
  workspace_id?: string | null;
  customerMessage?: string;
  shop?: Record<string, unknown>;
  supabase: SupabaseClient;
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

function extractIssueTerms(text: string): string[] {
  const lower = stripHtml(text).toLowerCase();
  const terms: string[] = [];
  const addIf = (term: string, pattern: RegExp) => {
    if (pattern.test(lower)) terms.push(term);
  };
  addIf("app", /\b(app|ios|android)\b/);
  addIf(
    "connect",
    /\b(connect|connection|pair|paired|forbind|forbinde|tilslut)\b/,
  );
  addIf("firmware", /\b(firmware|update|updater|opdater)\b/);
  addIf("factory reset", /\b(factory reset|reset|nulstil)\b/);
  addIf("audio", /\b(audio|sound|lyd|cable|kabel|usb|usb-c)\b/);
  addIf("microphone", /\b(mic|microphone|mikrofon|mute|unmute)\b/);
  addIf("battery", /\b(battery|batteri|charging|charge|strøm|oplade)\b/);
  addIf("ear pads", /\b(ear\s*pads?|earpads?|ørepuder?)\b/);
  addIf(
    "damage",
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
  if (issues.includes("ear pads")) {
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
}): Pick<RetrievedChunk, "usable_as" | "risk_flags"> {
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
      .test(content)
  ) {
    usable_as = "procedure";
  } else if (kind === "ticket") {
    usable_as = "tone_example";
  }

  if (/\b(marketing|newsletter|press release|campaign)\b/.test(lower)) {
    usable_as = "ignore";
  }

  return { usable_as, risk_flags: [...new Set(riskFlags)] };
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
  { plan, shop_id, workspace_id, customerMessage, shop, supabase }:
    RetrieverInput,
): Promise<RetrieverResult> {
  const queries = uniqueStrings([
    ...plan.sub_queries.filter(Boolean),
    ...buildFallbackQueries(plan, customerMessage, shop),
  ]).slice(0, 5);
  if (queries.length === 0) return { chunks: [], past_ticket_examples: [] };

  // Run knowledge queries + ticket lookup in parallel. Saved replies are indexed
  // into agent_knowledge with source_provider='saved_reply', so they use the same
  // metadata/product retrieval path as other knowledge.
  const [queryPairs, ticketResult] = await Promise.all([
    Promise.all(queries.map((q) => runQueryPair(q, shop_id, supabase))),
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
              const score = Number(item.similarity || 0) + lexicalScore;
              const existing = resultMap.get(String(item.id));
              if (!existing || score > existing.score) {
                resultMap.set(String(item.id), {
                  customer_msg: item.customer_msg,
                  agent_reply: item.agent_reply,
                  subject: item.subject,
                  intent: item.intent,
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
          .slice(0, 3);
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

  const fused = rrfFusion(allLists);

  // Knowledge chunks include saved replies indexed into agent_knowledge.
  const knowledgeBudget = 8;
  const queryText = `${queries.join(" ")} ${customerMessage || ""}`;
  const productTerms = extractMentionedProductTerms(queryText, shop);
  const issueTerms = extractIssueTerms(queryText);
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
      const score = (chunk: RetrievedChunk) =>
        chunk.similarity +
        overlapCount(`${chunk.source_label} ${chunk.content}`, productTerms) *
          0.08 +
        overlapCount(`${chunk.source_label} ${chunk.content}`, issueTerms) *
          0.04 +
        (/manual_text|snippet/i.test(`${chunk.source_label} ${chunk.kind}`)
          ? 0.04
          : 0) +
        (chunk.usable_as === "saved_reply" ? 0.06 : 0) +
        (chunk.usable_as === "policy" ? 0.02 : 0);
      return score(b) - score(a);
    })
    .slice(0, knowledgeBudget);

  // Past ticket examples — directly from typed ticket_examples table
  const pastTicketExamples = ticketResult
    .filter((t) => t.agent_reply && t.agent_reply.length > 20)
    .map((t) => ({ customer_msg: t.customer_msg, agent_reply: t.agent_reply }));

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
