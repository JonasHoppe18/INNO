import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const ALLOWED_MODELS = new Set(["gpt-4o-mini", "gpt-4o"]);

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
  const ticketSubject =
    typeof body.ticketSubject === "string" && body.ticketSubject.trim()
      ? body.ticketSubject.trim()
      : "Customer support inquiry";
  const customerFrom =
    typeof body.customerFrom === "string" && body.customerFrom.trim()
      ? body.customerFrom.trim()
      : "Customer";
  const requestedModel =
    typeof body.model === "string" && ALLOWED_MODELS.has(body.model.trim())
      ? body.model.trim()
      : OPENAI_MODEL;

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
    "Dette er en test, så giv ikke løfter der ikke er dækning for i politikkerne. " +
    "Svar KUN med gyldig JSON.\n\n" +
    "JSON format:\n" +
    "{\n" +
    '  "reply": "full email reply text",\n' +
    '  "thought": "short internal summary, max 12 words",\n' +
    '  "actions": [\n' +
    '    { "tool": "write_email_draft_response", "detail": "what happened", "duration_ms": 200 }\n' +
    "  ]\n" +
    "}\n\n" +
    "Action rules:\n" +
    "- First action must always be write_email_draft_response.\n" +
    "- Last action must always be update_ticket_by_id.\n" +
    "- Include send_email_response when response should be sent.\n" +
    "- If ticket implies order/refund/address/cancel/tracking change, include one relevant Shopify tool action.\n" +
    "- Keep actions short and realistic." +
    policyContext;

  const userMessage = [
    `Ticket subject: ${ticketSubject}`,
    `Customer: ${customerFrom}`,
    `Kundens besked: ${scenario}`,
    `Tone og instruktioner: ${instructions}`,
    signature ? `Afslut med denne signatur:\n${signature}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: requestedModel,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const elapsedMs = Date.now() - startedAt;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.error?.message || "OpenAI request failed.";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  const raw = data?.choices?.[0]?.message?.content;
  let parsed = null;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const fallbackReply =
    typeof raw === "string" && raw.trim().length
      ? raw.trim()
      : "Tak for din besked. Vi undersøger sagen og vender tilbage hurtigst muligt.";

  const reply =
    typeof parsed?.reply === "string" && parsed.reply.trim().length
      ? parsed.reply.trim()
      : fallbackReply;

  const thought =
    typeof parsed?.thought === "string" && parsed.thought.trim().length
      ? parsed.thought.trim()
      : `Thought for ${Math.max(3, Math.round(elapsedMs / 1000))} seconds`;

  const normalizedActions = Array.isArray(parsed?.actions)
    ? parsed.actions
        .map((item) => ({
          tool:
            typeof item?.tool === "string" && item.tool.trim()
              ? item.tool.trim()
              : null,
          detail:
            typeof item?.detail === "string" && item.detail.trim()
              ? item.detail.trim()
              : "Simulation action",
          duration_ms:
            Number.isFinite(Number(item?.duration_ms)) && Number(item.duration_ms) > 0
              ? Math.round(Number(item.duration_ms))
              : null,
        }))
        .filter((item) => Boolean(item.tool))
    : [];

  const actions = [];
  if (!normalizedActions.some((item) => item.tool === "write_email_draft_response")) {
    actions.push({
      tool: "write_email_draft_response",
      detail: "Draft generated from persona instructions.",
      duration_ms: 240,
    });
  }
  actions.push(...normalizedActions);
  if (!actions.some((item) => item.tool === "send_email_response")) {
    actions.push({
      tool: "send_email_response",
      detail: "Draft prepared for outbound response in simulation.",
      duration_ms: 420,
    });
  }
  if (!actions.some((item) => item.tool === "update_ticket_by_id")) {
    actions.push({
      tool: "update_ticket_by_id",
      detail: "Ticket metadata updated after simulation.",
      duration_ms: 64,
    });
  }

  return NextResponse.json({
    reply,
    model: requestedModel,
    trace: {
      thought,
      actions,
    },
  });
}
