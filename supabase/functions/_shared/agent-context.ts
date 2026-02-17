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
  internal_tone: string;
};

export type OwnerProfile = {
  first_name: string;
  last_name: string;
  signature: string;
};

export const DEFAULT_PERSONA: Persona = {
  signature: "",
  scenario: "",
  instructions: "",
};

export const DEFAULT_AUTOMATION: Automation = {
  order_updates: true,
  cancel_orders: true,
  automatic_refunds: false,
  historic_inbox_access: false,
  learn_from_edits: false,
  draft_destination: "email_provider",
};

export const DEFAULT_POLICIES: Policies = {
  policy_refund: "",
  policy_shipping: "",
  policy_terms: "",
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
): Promise<Automation> {
  if (!supabase || !userId) return DEFAULT_AUTOMATION;
  const { data, error } = await supabase
    .from("agent_automation")
    .select(
      "order_updates,cancel_orders,automatic_refunds,historic_inbox_access,learn_from_edits,draft_destination"
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("agent-context: kunne ikke hente automation", error);
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
): Promise<Policies> {
  if (!supabase || !userId) return DEFAULT_POLICIES;
  const { data, error } = await supabase
    .from("shops")
    .select("policy_refund,policy_shipping,policy_terms,internal_tone")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("agent-context: kunne ikke hente policies", error);
  }
  return {
    policy_refund: data?.policy_refund ?? DEFAULT_POLICIES.policy_refund,
    policy_shipping: data?.policy_shipping ?? DEFAULT_POLICIES.policy_shipping,
    policy_terms: data?.policy_terms ?? DEFAULT_POLICIES.policy_terms,
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
