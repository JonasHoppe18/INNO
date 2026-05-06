import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope } from "@/lib/server/workspace-auth";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
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

function actionLabel(type = "") {
  const labels = {
    update_shipping_address: "shipping address update",
    cancel_order: "order cancellation",
    refund_order: "refund",
    initiate_return: "return initiation",
    create_exchange_request: "exchange request",
    send_return_instructions: "return instructions",
    add_note: "internal note",
    add_tag: "internal tag",
  };
  return labels[String(type || "").trim()] || String(type || "").replace(/_/g, " ");
}

function approvedOutcome(action = {}) {
  const type = String(action?.type || "");
  const params = action?.params && typeof action.params === "object" ? action.params : {};
  const orderName = String(params.order_name || params.order_number || "").trim();
  const orderRef = orderName ? ` for order ${orderName}` : "";
  if (type === "update_shipping_address") {
    return `The shipping address${orderRef} has been updated.`;
  }
  if (type === "cancel_order") {
    return `The cancellation${orderRef} has been completed.`;
  }
  if (type === "refund_order") {
    return `The refund${orderRef} has been issued.`;
  }
  if (type === "initiate_return") {
    return `The return${orderRef} has been initiated.`;
  }
  return `The ${actionLabel(type)}${orderRef} has been completed.`;
}

function declinedOutcome(action = {}) {
  const type = String(action?.type || "");
  return `The proposed ${actionLabel(type)} was not approved, so no changes were made.`;
}

function fallbackReply({ customerName, outcome }) {
  const name = customerName || "there";
  return [`Hi ${name},`, "", outcome, "", "Let us know if there is anything else we can help with."].join("\n");
}

function clamp10(value) {
  return Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
}

function toFive(value) {
  return Math.max(1, Math.min(5, Math.round(clamp10(value) / 2)));
}

async function judgeReply({
  subject,
  customerMessage,
  humanReply,
  action,
  decision,
  reply,
}) {
  if (!OPENAI_API_KEY || !reply) {
    return null;
  }
  const systemPrompt = [
    "You are a strict customer support QA evaluator.",
    "Score the final customer-facing reply after an action review from 1 to 10.",
    "A 10/10 reply is factually correct, matches the customer's language, clearly communicates the outcome, avoids internal/test-mode wording, and could be sent as-is.",
    "Return ONLY valid JSON.",
  ].join(" ");
  const userPrompt = [
    `Subject: ${subject || "(none)"}`,
    "",
    "Customer message:",
    customerMessage || "(none)",
    "",
    humanReply ? `Human reference reply:\n${humanReply}\n` : "",
    "Action decision:",
    `${decision} ${String(action?.type || "").replace(/_/g, " ")}`,
    "",
    "Final customer reply:",
    reply,
    "",
    `Return JSON:
{
  "correctness": 1-10,
  "completeness": 1-10,
  "tone": 1-10,
  "actionability": 1-10,
  "overall_10": 1-10,
  "send_ready": true,
  "primary_gap": "short label or empty",
  "missing_for_10": ["concrete missing item"],
  "likely_root_cause": "action_decision|writer|language|policy|facts|other",
  "reasoning": "one concise sentence"
}`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 420,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  const overall10 = clamp10(parsed.overall_10);
  return {
    correctness: toFive(parsed.correctness),
    completeness: toFive(parsed.completeness),
    tone: toFive(parsed.tone),
    actionability: toFive(parsed.actionability),
    overall: toFive(overall10),
    overall_10: overall10,
    send_ready: parsed.send_ready === true || overall10 >= 9,
    primary_gap: String(parsed.primary_gap || "").trim() || null,
    missing_for_10: Array.isArray(parsed.missing_for_10)
      ? parsed.missing_for_10.map((item) => String(item)).filter(Boolean)
      : [],
    likely_root_cause: String(parsed.likely_root_cause || "").trim() || null,
    reasoning: String(parsed.reasoning || "").trim(),
  };
}

function simulatedInternalNote(decision, action = {}) {
  const type = String(action?.type || "").replace(/_/g, " ") || "action";
  return decision === "approved"
    ? `Eval simulation only: ${type} would be executed in production. No Shopify mutation was made.`
    : `Eval simulation only: ${type} was rejected. No Shopify mutation was made.`;
}

async function scopedShopIdsForUser(supabase, clerkUserId, orgId) {
  const scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  const shops = await listScopedShops(supabase, scope, { fields: "id" });
  return shops.map((shop) => shop.id).filter(Boolean);
}

async function persistDecision({
  clerkUserId,
  orgId,
  evalResultId,
  decision,
  action,
  reply,
  quality,
  simulatedNote,
}) {
  if (!evalResultId) {
    return { persisted: false, decidedAt: null };
  }
  const supabase = createServiceClient();
  if (!supabase) {
    throw new Error("Supabase not configured");
  }
  const shopIds = await scopedShopIdsForUser(supabase, clerkUserId, orgId);
  if (shopIds.length === 0) {
    throw new Error("No shops found for this workspace");
  }

  const decidedAt = new Date().toISOString();
  const actionDecision = {
    decision,
    action,
    test_mode: true,
    simulated_internal_note: simulatedNote,
    decided_at: decidedAt,
  };
  const qualityPatch = quality ? {
    correctness: quality.correctness,
    completeness: quality.completeness,
    tone: quality.tone,
    actionability: quality.actionability,
    overall: quality.overall,
    overall_10: quality.overall_10,
    send_ready: quality.send_ready,
    primary_gap: quality.primary_gap,
    missing_for_10: quality.missing_for_10,
    likely_root_cause: quality.likely_root_cause,
    reasoning: quality.reasoning,
  } : {};

  const { data, error } = await supabase
    .from("eval_results")
    .update({
      action_decision: actionDecision,
      post_action_reply: reply,
      post_action_quality: quality,
      post_action_decided_at: decidedAt,
      ...qualityPatch,
    })
    .eq("id", evalResultId)
    .in("shop_id", shopIds)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data?.id) {
    throw new Error("Eval result not found in this workspace");
  }

  return { persisted: true, decidedAt, actionDecision };
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const decision = String(body?.decision || "").trim().toLowerCase() === "rejected"
    ? "rejected"
    : "approved";
  const action = body?.action && typeof body.action === "object" ? body.action : {};
  const customerMessage = String(body?.ticket_body || body?.customer_message || "").trim();
  const subject = String(body?.subject || "").trim();
  const humanReply = String(body?.human_reply || "").trim();
  const customerName = String(body?.customer_name || "").trim();
  const evalResultId = String(body?.eval_result_id || "").trim();
  const outcome = decision === "approved" ? approvedOutcome(action) : declinedOutcome(action);
  const simulatedNote = simulatedInternalNote(decision, action);

  if (!OPENAI_API_KEY) {
    const reply = fallbackReply({ customerName, outcome });
    let persisted = { persisted: false, decidedAt: null, actionDecision: null };
    try {
      persisted = await persistDecision({
        clerkUserId,
        orgId,
        evalResultId,
        decision,
        action,
        reply,
        quality: null,
        simulatedNote,
      });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({
      decision,
      test_mode: true,
      simulated_internal_note: simulatedNote,
      reply,
      persisted: persisted.persisted,
      decided_at: persisted.decidedAt,
      action_decision: persisted.actionDecision,
      quality: null,
    });
  }

  const systemPrompt = [
    "You are Sona, a customer support assistant writing the customer-facing reply after an agent reviewed a proposed action.",
    "Reply in the same language as the customer's latest message.",
    "Use the outcome exactly as the source of truth.",
    "Do not mention test mode, simulation, internal approval, Shopify mutation, or implementation details.",
    "Keep it short: greeting, one clear outcome paragraph, one short closing line.",
    "Do not add signatures or invented details.",
  ].join(" ");

  const userPrompt = [
    `Subject: ${subject || "(none)"}`,
    "",
    "Customer latest message:",
    customerMessage || "(none)",
    "",
    humanReply ? `Human reference reply:\n${humanReply}\n` : "",
    "Outcome to communicate:",
    outcome,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 260,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: data?.error?.message || `OpenAI error ${res.status}` },
      { status: 500 },
    );
  }

  const reply = String(data?.choices?.[0]?.message?.content || "").trim() ||
    fallbackReply({ customerName, outcome });
  const quality = await judgeReply({
    subject,
    customerMessage,
    humanReply,
    action,
    decision,
    reply,
  });
  let persisted = { persisted: false, decidedAt: null, actionDecision: null };
  try {
    persisted = await persistDecision({
      clerkUserId,
      orgId,
      evalResultId,
      decision,
      action,
      reply,
      quality,
      simulatedNote,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({
    decision,
    test_mode: true,
    simulated_internal_note: simulatedNote,
    reply,
    quality,
    persisted: persisted.persisted,
    decided_at: persisted.decidedAt,
    action_decision: persisted.actionDecision,
  });
}
