import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchShopPolicies(clerkUserId, orgId) {
  const serviceClient = createServiceClient();
  if (!serviceClient) return null;

  let scope;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch {
    return null;
  }

  if (!scope?.workspaceId) return null;

  const { data: shop } = await serviceClient
    .from("shops")
    .select("team_name, policy_refund, policy_shipping, policy_terms, internal_tone")
    .eq("workspace_id", scope.workspaceId)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return shop || null;
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) ?? {};
  const signature =
    typeof body.signature === "string" && body.signature.trim()
      ? body.signature.trim()
      : "Venlig hilsen\nDin agent";
  const scenario =
    typeof body.scenario === "string" && body.scenario.trim()
      ? body.scenario.trim()
      : "kunden har et generelt spørgsmål";
  const instructions =
    typeof body.instructions === "string" && body.instructions.trim()
      ? body.instructions.trim()
      : "hold tonen venlig og effektiv";
  const emailLanguage =
    typeof body.emailLanguage === "string" && body.emailLanguage.trim()
      ? body.emailLanguage.trim()
      : null;

  // Fetch shop policies for a more realistic response
  const shop = await fetchShopPolicies(clerkUserId, orgId);

  const policyLines = [];
  if (shop?.policy_refund) policyLines.push(`Returpolitik: ${shop.policy_refund}`);
  if (shop?.policy_shipping) policyLines.push(`Forsendelsespolitik: ${shop.policy_shipping}`);
  if (shop?.policy_terms) policyLines.push(`Vilkår: ${shop.policy_terms}`);
  if (shop?.internal_tone) policyLines.push(`Interne retningslinjer: ${shop.internal_tone}`);

  const policyContext = policyLines.length > 0
    ? `\n\nBUTIKKENS POLITIKKER (følg disse):\n${policyLines.join("\n\n")}`
    : "";

  const shopName = shop?.team_name || null;

  const languageRule = emailLanguage
    ? `LANGUAGE RULE (highest priority): The customer wrote in ${emailLanguage}. You MUST reply in ${emailLanguage} only. Do not switch language under any circumstance.`
    : "LANGUAGE RULE: Always reply in the same language the customer used.";

  const systemPrompt =
    `${languageRule}\n\n` +
    `Du er en kundeservice-agent${shopName ? ` for ${shopName}` : ""}. ` +
    "Skriv et realistisk svar til kunden baseret på butikkens politikker og dine instruktioner. " +
    "Undgå placeholders som {navn} — brug en generisk hilsen. " +
    "Dette er en test, så giv ikke løfter der ikke er dækning for i politikkerne." +
    policyContext;

  const userMessage = [
    `Kundens besked: ${scenario}`,
    `Tone og instruktioner: ${instructions}`,
    signature ? `Afslut med denne signatur:\n${signature}` : "",
  ].filter(Boolean).join("\n\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.error?.message || "OpenAI request failed.";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return NextResponse.json({ error: "OpenAI returned no response." }, { status: 502 });
  }

  return NextResponse.json({ reply, model: OPENAI_MODEL });
}
