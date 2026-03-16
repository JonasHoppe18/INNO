import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type Persona = {
  signature: string;
  scenario: string;
  instructions: string;
};

export type Automation = {
  order_updates: boolean;
  cancel_orders: boolean;
  automatic_refunds: boolean;
  historic_inbox_access: boolean;
  learn_from_edits: boolean;
  draft_destination: "email_provider" | "sona_inbox";
};

export type Policies = {
  policy_refund: string;
  policy_shipping: string;
  policy_terms: string;
  policy_privacy: string;
  policy_summary_json: Record<string, unknown> | null;
  policy_summary_version: number;
  policy_summary_updated_at: string | null;
  internal_tone: string;
};

export type OwnerProfile = {
  first_name: string;
  last_name: string;
  signature: string;
};

export type KnowledgeMatch = {
  id: number;
  content: string;
  source_type: "ticket" | "document" | "snippet" | string;
  source_provider: string;
  metadata?: Record<string, unknown> | null;
  similarity?: number;
};

const KNOWLEDGE_PROVIDER_PRIORITY: Record<string, number> = {
  manual_text: 500,
  pdf_upload: 460,
  image_upload: 450,
  shopify_file: 430,
  shopify_page: 390,
  shopify_product: 380,
  shopify_variant: 370,
  shopify_policy: 360,
  shopify_collection: 340,
  shopify_metaobject: 330,
  shopify_metafield: 320,
  shopify_blog_article: 310,
  csv_support_knowledge: 300,
  zendesk: 50,
};

const KNOWLEDGE_PROVIDER_LIMITS: Record<string, number> = {
  zendesk: 1,
};

function getKnowledgeProviderPriority(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toLowerCase();
  return KNOWLEDGE_PROVIDER_PRIORITY[normalized] ?? 100;
}

function getKnowledgeProviderLimit(provider: string | null | undefined) {
  const normalized = String(provider || "").trim().toLowerCase();
  return KNOWLEDGE_PROVIDER_LIMITS[normalized] ?? 2;
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

export const DEFAULT_PERSONA: Persona = {
  signature: "",
  scenario: "",
  instructions: "",
};

export const DEFAULT_AUTOMATION: Automation = {
  order_updates: false,
  cancel_orders: false,
  automatic_refunds: false,
  historic_inbox_access: false,
  learn_from_edits: false,
  draft_destination: "sona_inbox",
};

export const DEFAULT_POLICIES: Policies = {
  policy_refund: "",
  policy_shipping: "",
  policy_terms: "",
  policy_privacy: "",
  policy_summary_json: null,
  policy_summary_version: 0,
  policy_summary_updated_at: null,
  internal_tone: "",
};

export const DEFAULT_OWNER_PROFILE: OwnerProfile = {
  first_name: "",
  last_name: "",
  signature: "",
};

// Finder Supabase user_id ud fra Clerk userId via profiles-tabellen
export async function resolveSupabaseUserId(
  supabase: SupabaseClient | null,
  clerkUserId: string,
): Promise<string> {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient ikke initialiseret (resolveSupabaseUserId)."), {
      status: 500,
    });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke slå Supabase userId op fra Clerk userId: ${error.message}`),
      { status: 500 },
    );
  }

  if (!data?.user_id) {
    throw Object.assign(
      new Error("Der findes ingen Supabase bruger for den angivne Clerk userId."),
      { status: 404 },
    );
  }

  return data.user_id;
}

// Henter gemt persona eller falder tilbage til default
export async function fetchPersona(
  supabase: SupabaseClient | null,
  userId: string | null,
): Promise<Persona> {
  if (!supabase || !userId) return DEFAULT_PERSONA;
  const { data, error } = await supabase
    .from("agent_persona")
    .select("scenario,instructions")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("agent-context: kunne ikke hente persona", error);
  }
  return {
    signature: DEFAULT_PERSONA.signature,
    scenario: data?.scenario ?? DEFAULT_PERSONA.scenario,
    instructions: data?.instructions ?? DEFAULT_PERSONA.instructions,
  };
}

// Henter automation-flag for brugeren og fallbacker hvis mangler
export async function fetchAutomation(
  supabase: SupabaseClient | null,
  userId: string | null,
  workspaceId: string | null = null,
): Promise<Automation> {
  if (!supabase || (!userId && !workspaceId)) return DEFAULT_AUTOMATION;
  let data: any = null;

  if (workspaceId) {
    const { data: workspaceData, error: workspaceError } = await supabase
      .from("agent_automation")
      .select(
        "order_updates,cancel_orders,automatic_refunds,historic_inbox_access,learn_from_edits,draft_destination"
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (workspaceError) {
      console.warn("agent-context: kunne ikke hente workspace automation", workspaceError);
    } else if (workspaceData) {
      data = workspaceData;
    }
  }

  if (!data && userId) {
    const { data: userData, error } = await supabase
      .from("agent_automation")
      .select(
        "order_updates,cancel_orders,automatic_refunds,historic_inbox_access,learn_from_edits,draft_destination"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("agent-context: kunne ikke hente user automation", error);
    } else {
      data = userData;
    }
  }

  return {
    order_updates:
      typeof data?.order_updates === "boolean"
        ? data.order_updates
        : DEFAULT_AUTOMATION.order_updates,
    cancel_orders:
      typeof data?.cancel_orders === "boolean"
        ? data.cancel_orders
        : DEFAULT_AUTOMATION.cancel_orders,
    automatic_refunds:
      typeof data?.automatic_refunds === "boolean"
        ? data.automatic_refunds
        : DEFAULT_AUTOMATION.automatic_refunds,
    historic_inbox_access:
      typeof data?.historic_inbox_access === "boolean"
        ? data.historic_inbox_access
        : DEFAULT_AUTOMATION.historic_inbox_access,
    learn_from_edits:
      typeof data?.learn_from_edits === "boolean"
        ? data.learn_from_edits
        : DEFAULT_AUTOMATION.learn_from_edits,
    draft_destination:
      data?.draft_destination === "sona_inbox"
        ? "sona_inbox"
        : DEFAULT_AUTOMATION.draft_destination,
  };
}

// Bygger menneskelæsbar tekst af automation-reglerne til prompts
export function buildAutomationGuidance(automation: Automation) {
  const lines = [];
  lines.push(
    automation.order_updates
      ? "- Du må opdatere adresse/kontaktinfo direkte i Shopify."
      : "- Du må ikke love at ændre adresse/kontaktinfo uden manuel bekræftelse.",
  );
  lines.push(
    automation.cancel_orders
      ? "- Du må annullere åbne ordrer uden ekstra godkendelse."
      : "- Du må ikke love at annullere en ordre automatisk.",
  );
  lines.push(
    automation.automatic_refunds
      ? "- Du må gennemføre refunderinger, hvis kundens ønske er rimeligt."
      : "- Du må ikke love refundering uden at nævne manuel kontrol.",
  );
  lines.push(
    automation.historic_inbox_access
      ? "- Du har adgang til historik og kan henvise til tidligere henvendelser."
      : "- Hvis historik mangler, så bed om ekstra detaljer.",
  );
  return lines.join("\n");
}

// Henter nyeste politikker for brugeren eller returnerer tomme defaults
export async function fetchPolicies(
  supabase: SupabaseClient | null,
  userId: string | null,
  workspaceId: string | null = null,
): Promise<Policies> {
  if (!supabase || (!userId && !workspaceId)) return DEFAULT_POLICIES;
  let data: any = null;

  if (workspaceId) {
    const { data: workspaceData, error: workspaceError } = await supabase
      .from("shops")
      .select(
        "policy_refund,policy_shipping,policy_terms,policy_privacy,policy_summary_json,policy_summary_version,policy_summary_updated_at,internal_tone",
      )
      .eq("workspace_id", workspaceId)
      .is("uninstalled_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (workspaceError) {
      console.warn("agent-context: kunne ikke hente workspace policies", workspaceError);
    } else if (workspaceData) {
      data = workspaceData;
    }
  }

  if (!data && userId) {
    const { data: userData, error } = await supabase
      .from("shops")
      .select(
        "policy_refund,policy_shipping,policy_terms,policy_privacy,policy_summary_json,policy_summary_version,policy_summary_updated_at,internal_tone",
      )
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("agent-context: kunne ikke hente user policies", error);
    } else {
      data = userData;
    }
  }

  return {
    policy_refund: data?.policy_refund ?? DEFAULT_POLICIES.policy_refund,
    policy_shipping: data?.policy_shipping ?? DEFAULT_POLICIES.policy_shipping,
    policy_terms: data?.policy_terms ?? DEFAULT_POLICIES.policy_terms,
    policy_privacy: data?.policy_privacy ?? DEFAULT_POLICIES.policy_privacy,
    policy_summary_json:
      data?.policy_summary_json && typeof data.policy_summary_json === "object"
        ? data.policy_summary_json
        : DEFAULT_POLICIES.policy_summary_json,
    policy_summary_version:
      Number.isInteger(Number(data?.policy_summary_version))
        ? Number(data.policy_summary_version)
        : DEFAULT_POLICIES.policy_summary_version,
    policy_summary_updated_at:
      typeof data?.policy_summary_updated_at === "string"
        ? data.policy_summary_updated_at
        : DEFAULT_POLICIES.policy_summary_updated_at,
    internal_tone: data?.internal_tone ?? DEFAULT_POLICIES.internal_tone,
  };
}

// Henter profil-oplysninger for shop owner, inkl. brugerens signatur
export async function fetchOwnerProfile(
  supabase: SupabaseClient | null,
  userId: string | null,
): Promise<OwnerProfile> {
  if (!supabase || !userId) return DEFAULT_OWNER_PROFILE;
  const { data, error } = await supabase
    .from("profiles")
    .select("first_name,last_name,signature")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("agent-context: kunne ikke hente owner profile", error);
  }
  return {
    first_name: data?.first_name ?? DEFAULT_OWNER_PROFILE.first_name,
    last_name: data?.last_name ?? DEFAULT_OWNER_PROFILE.last_name,
    signature:
      data?.signature?.trim()?.length
        ? data.signature
        : DEFAULT_OWNER_PROFILE.signature,
  };
}

async function embedKnowledgeQuery(input: string): Promise<number[] | null> {
  const trimmed = String(input || "").trim();
  if (!trimmed || !OPENAI_API_KEY) return null;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: trimmed.slice(0, 4000),
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.warn("agent-context: embedding failed", payload?.error?.message ?? res.status);
    return null;
  }
  const embedding = payload?.data?.[0]?.embedding;
  return Array.isArray(embedding) ? embedding : null;
}

export async function fetchRelevantKnowledge(
  supabase: SupabaseClient | null,
  shopId: string | null,
  emailBody: string | null,
  limit = 4,
  minSimilarity = 0,
): Promise<KnowledgeMatch[]> {
  if (!supabase || !shopId || !emailBody?.trim()) return [];

  const queryEmbedding = await embedKnowledgeQuery(emailBody);
  if (!queryEmbedding) return [];

  const safeLimit = Math.max(1, Math.min(limit, 5));
  const retrievalLimit = Math.max(safeLimit * 4, 12);
  const { data, error } = await supabase.rpc("match_agent_knowledge", {
    query_embedding: queryEmbedding,
    match_count: retrievalLimit,
    filter_shop_id: shopId,
  });

  if (error) {
    console.warn("agent-context: could not fetch agent knowledge", error);
    return [];
  }

  if (!Array.isArray(data)) return [];
  const threshold = Number.isFinite(minSimilarity) ? Number(minSimilarity) : 0;
  const matches = data as KnowledgeMatch[];
  const filtered = threshold <= 0
    ? matches
    : matches.filter((match) => Number(match?.similarity ?? 0) >= threshold);
  const reranked = filtered
    .map((match, index) => {
      const provider = String(match?.source_provider || "").trim().toLowerCase();
      const similarity = Number(match?.similarity ?? 0);
      const providerPriority = getKnowledgeProviderPriority(provider);
      const contentLength = String(match?.content || "").trim().length;
      const lengthPenalty = contentLength > 1200 ? 0.03 : contentLength > 800 ? 0.015 : 0;
      const adjustedScore = similarity + providerPriority / 1000 - lengthPenalty - index / 100000;
      return {
        match,
        provider,
        adjustedScore,
        similarity,
      };
    })
    .sort((left, right) => {
      if (right.adjustedScore !== left.adjustedScore) {
        return right.adjustedScore - left.adjustedScore;
      }
      return right.similarity - left.similarity;
    });

  const selected: KnowledgeMatch[] = [];
  const providerCounts = new Map<string, number>();
  for (const entry of reranked) {
    const count = providerCounts.get(entry.provider) ?? 0;
    if (count >= getKnowledgeProviderLimit(entry.provider)) continue;
    selected.push(entry.match);
    providerCounts.set(entry.provider, count + 1);
    if (selected.length >= safeLimit) break;
  }
  return selected;
}

export function formatKnowledgeForPrompt(matches: KnowledgeMatch[]): string {
  if (!Array.isArray(matches) || !matches.length) return "";

  const lines = ["RELEVANT KNOWLEDGE & HISTORY:"];
  matches.forEach((match, index) => {
    const type = match?.source_type || "snippet";
    const provider = match?.source_provider ? `, Provider: ${match.source_provider}` : "";
    const content = String(match?.content || "").trim();
    if (!content) return;
    lines.push(`[${index + 1}] (Type: ${type}${provider}) ${content}`);
  });

  return lines.join("\n");
}
