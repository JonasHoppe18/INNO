import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const JUDGE_SYSTEM_PROMPT = `You are an expert customer service quality evaluator.
You will be given a customer support ticket and a draft response written by an AI.
Score the draft on four dimensions, each from 1 to 5:

- correctness: Are the steps/information accurate and appropriate for the specific product and issue described?
- completeness: Are all necessary steps or information included? Nothing important missing?
- tone: Is the response professional, empathetic, and appropriately warm?
- actionability: Can the customer immediately act on this response without needing more info?

overall: Your holistic score (1-5) for whether a support agent could send this as-is without editing.

Return ONLY valid JSON, no markdown:
{
  "correctness": <1-5>,
  "completeness": <1-5>,
  "tone": <1-5>,
  "actionability": <1-5>,
  "overall": <1-5>,
  "reasoning": "<1-2 sentences explaining the overall score>"
}`;

async function judgeWithOpenAI(ticketBody, draftContent) {
  const userPrompt = `CUSTOMER TICKET:\n${ticketBody}\n\nDRAFT RESPONSE:\n${draftContent}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "OpenAI judge failed");
  return JSON.parse(data?.choices?.[0]?.message?.content || "{}");
}

async function generateDraft(emailBody, instructions, shopContext) {
  const systemMsg = [
    instructions
      ? `You are a customer support agent. Follow these instructions:\n${instructions}`
      : "You are a professional customer support agent.",
    shopContext || "",
    "Write a helpful, specific reply to the customer's message. Be concise but complete.",
  ].filter(Boolean).join("\n\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: emailBody },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "Draft generation failed");
  return data?.choices?.[0]?.message?.content || "";
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { emails, thread_ids, run_label, model = "gpt-4o" } = body;

  if (!run_label) {
    return NextResponse.json({ error: "run_label required" }, { status: 400 });
  }

  const hasEmails = Array.isArray(emails) && emails.length > 0;
  const hasThreads = Array.isArray(thread_ids) && thread_ids.length > 0;
  if (!hasEmails && !hasThreads) {
    return NextResponse.json({ error: "emails or thread_ids required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  let scope;
  try {
    scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const shopQuery = supabase
    .from("shops")
    .select("id, shop_name, team_name, brand_description, product_overview")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (scope?.workspaceId) shopQuery.eq("workspace_id", scope.workspaceId);
  else if (scope?.userId) shopQuery.eq("owner_user_id", scope.userId);
  const { data: shop } = await shopQuery.maybeSingle();

  // Fetch persona instructions
  let instructions = null;
  if (scope?.workspaceId) {
    const { data: persona } = await supabase
      .from("agent_personas")
      .select("instructions")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    instructions = persona?.instructions || null;
  }

  const shopName = shop?.shop_name || shop?.team_name || null;
  const shopContext = [
    shopName ? `Shop: ${shopName}` : null,
    shop?.brand_description || null,
    shop?.product_overview ? `Products: ${shop.product_overview}` : null,
  ].filter(Boolean).join("\n");

  const results = [];
  const errors = [];

  // Mode 1: pasted emails — generate draft then judge
  if (hasEmails) {
    for (const email of emails) {
      const ticketBody = email.body?.trim();
      const ticketSubject = email.subject?.trim() || null;
      if (!ticketBody) continue;
      try {
        const draft = await generateDraft(ticketBody, instructions, shopContext);
        const scores = await judgeWithOpenAI(ticketBody, draft);
        const { data: inserted } = await supabase
          .from("eval_results")
          .insert({
            shop_id: shop?.id || null,
            thread_id: null,
            run_label,
            model,
            ticket_subject: ticketSubject,
            ticket_body: ticketBody.slice(0, 2000),
            draft_content: draft.slice(0, 2000),
            correctness: scores.correctness,
            completeness: scores.completeness,
            tone: scores.tone,
            actionability: scores.actionability,
            overall: scores.overall,
            reasoning: scores.reasoning,
          })
          .select("id")
          .single();
        results.push({ subject: ticketSubject, id: inserted?.id, scores, draft });
      } catch (err) {
        errors.push({ subject: ticketSubject, error: err.message });
      }
    }
  }

  // Mode 2: thread_ids — score existing drafts
  if (hasThreads) {
    for (const threadId of thread_ids) {
      try {
        const { data: draftMsg } = await supabase
          .from("mail_messages")
          .select("body, subject")
          .eq("thread_id", threadId)
          .eq("from_me", true)
          .eq("is_draft", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!draftMsg?.body) { errors.push({ thread_id: threadId, error: "No draft found" }); continue; }

        const { data: customerMsg } = await supabase
          .from("mail_messages")
          .select("body, subject")
          .eq("thread_id", threadId)
          .eq("from_me", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!customerMsg?.body) { errors.push({ thread_id: threadId, error: "No customer message" }); continue; }

        const scores = await judgeWithOpenAI(customerMsg.body, draftMsg.body);
        const { data: inserted } = await supabase
          .from("eval_results")
          .insert({
            shop_id: shop?.id || null,
            thread_id: threadId,
            run_label,
            model,
            ticket_subject: customerMsg.subject || draftMsg.subject || null,
            ticket_body: customerMsg.body.slice(0, 2000),
            draft_content: draftMsg.body.slice(0, 2000),
            correctness: scores.correctness,
            completeness: scores.completeness,
            tone: scores.tone,
            actionability: scores.actionability,
            overall: scores.overall,
            reasoning: scores.reasoning,
          })
          .select("id")
          .single();
        results.push({ thread_id: threadId, id: inserted?.id, scores });
      } catch (err) {
        errors.push({ thread_id: threadId, error: err.message });
      }
    }
  }

  const avg = (key) =>
    results.length > 0
      ? Math.round((results.reduce((s, r) => s + (r.scores[key] || 0), 0) / results.length) * 10) / 10
      : null;

  return NextResponse.json({
    run_label,
    model,
    scored: results.length,
    errors: errors.length > 0 ? errors : undefined,
    averages: {
      correctness: avg("correctness"),
      completeness: avg("completeness"),
      tone: avg("tone"),
      actionability: avg("actionability"),
      overall: avg("overall"),
    },
    results,
  });
}
