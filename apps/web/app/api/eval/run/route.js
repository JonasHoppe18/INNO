import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope, listScopedShops } from "@/lib/server/workspace-auth";

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
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";

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

const JUDGE_WITH_HUMAN_PROMPT = `You are an expert customer service quality evaluator.
You will be given a customer support ticket, an AI-generated draft response, and the actual response a human support agent sent.
Treat the human response as a strong reference answer, but not as something to copy blindly. Ignore signatures, greetings, and minor wording differences.
Score whether the AI draft is send-ready compared with the human response on four dimensions, each from 1 to 5:

- correctness: Does the AI answer the customer's actual request and avoid unsupported facts?
- completeness: Does the AI cover the same essential resolution/next-step points as the human reply, without adding irrelevant extras?
- tone: Is the AI's tone appropriate for the customer's situation and at least as natural as the human reply?
- actionability: Does the AI make the next step or outcome as clear as the human reply?

overall: Your holistic score (1-5) for sendability. 5 = the AI draft is as good as or better than the human reply and could be sent as-is. 3 = useful but needs edits. 1 = wrong or unsafe.

Return ONLY valid JSON, no markdown:
{
  "correctness": <1-5>,
  "completeness": <1-5>,
  "tone": <1-5>,
  "actionability": <1-5>,
  "overall": <1-5>,
  "reasoning": "<1-2 sentences naming the concrete gap or why it is send-ready>"
}`;

const JUDGE_MODELS = new Set(["gpt-4o-mini", "gpt-4o", "gpt-5-mini", "gpt-5-nano"]);

function normalizeJudgeModel(model) {
  return JUDGE_MODELS.has(model) ? model : "gpt-4o-mini";
}

async function judgeWithOpenAI(ticketBody, draftContent, humanReply = null, judgeModel = "gpt-4o-mini") {
  const systemPrompt = humanReply ? JUDGE_WITH_HUMAN_PROMPT : JUDGE_SYSTEM_PROMPT;
  const userPrompt = humanReply
    ? `CUSTOMER TICKET:\n${ticketBody}\n\nHUMAN AGENT REPLY:\n${humanReply}\n\nAI DRAFT:\n${draftContent}`
    : `CUSTOMER TICKET:\n${ticketBody}\n\nDRAFT RESPONSE:\n${draftContent}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: normalizeJudgeModel(judgeModel),
      messages: [
        { role: "system", content: systemPrompt },
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

async function generateDraft(shopId, subject, emailBody) {
  const startTime = Date.now();
  const endpoint = `${SUPABASE_URL}/functions/v1/generate-draft-unified`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        ...(INTERNAL_AGENT_SECRET ? { "x-internal-secret": INTERNAL_AGENT_SECRET } : {}),
      },
      body: JSON.stringify({
        shop_id: shopId,
        provider: "smtp",
        force_process: true,
        email_data: {
          subject: subject || "",
          body: emailBody,
          from: "eval@eval.internal",
          fromEmail: "eval@eval.internal",
          headers: [],
        },
      }),
    });
  } catch (fetchErr) {
    throw new Error(`Could not reach generate-draft-unified: ${fetchErr.message}`);
  }
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  if (!res.ok) {
    throw new Error(`generate-draft-unified ${res.status}: ${data?.error || raw.slice(0, 200)}`);
  }
  const draft = String(data?.reply || "").trim();
  if (!draft) {
    throw new Error(`generate-draft-unified returned no reply. Raw: ${raw.slice(0, 300)}`);
  }
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  return { draft, actions, confidence: null, sources: [], routingHint: null, latencyMs: Date.now() - startTime };
}

async function generateDraftV2(shopId, subject, emailBody, options = {}) {
  const startTime = Date.now();
  const endpoint = `${SUPABASE_URL}/functions/v1/generate-draft-v2`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        shop_id: shopId,
        email_data: {
          subject: subject || "",
          body: emailBody,
          from_email: "eval@eval.internal",
        },
        eval_options: {
          writer_model: options.writerModel || undefined,
          strong_model: options.strongModel || undefined,
          disable_escalation: options.disableEscalation === true,
        },
      }),
    });
  } catch (fetchErr) {
    throw new Error(`Could not reach generate-draft-v2: ${fetchErr.message}`);
  }
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  if (!res.ok) {
    throw new Error(`generate-draft-v2 ${res.status}: ${data?.error || raw.slice(0, 200)}`);
  }
  const draft = String(data?.draft_text || "").trim();
  if (!draft) {
    throw new Error(`generate-draft-v2 returned no draft. Raw: ${raw.slice(0, 300)}`);
  }
  const actions = Array.isArray(data?.proposed_actions) ? data.proposed_actions : [];
  const confidence = data?.confidence ?? null;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const routingHint = data?.routing_hint ?? null;
  const latencyMs = Number.isFinite(Number(data?.latency_ms)) ? Number(data.latency_ms) : Date.now() - startTime;
  return { draft, actions, confidence, sources, routingHint, latencyMs };
}

export async function POST(req) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    emails,
    thread_ids,
    zendesk_tickets,
    run_label,
    model = "gpt-4o-mini",
    strong_model = "gpt-4o",
    judge_model = "gpt-4o-mini",
    disable_escalation = false,
    pipeline = "legacy",
  } = body;
  const v2Options = {
    writerModel: model,
    strongModel: strong_model,
    disableEscalation: disable_escalation === true,
  };

  if (!run_label) {
    return NextResponse.json({ error: "run_label required" }, { status: 400 });
  }

  const hasEmails = Array.isArray(emails) && emails.length > 0;
  const hasThreads = Array.isArray(thread_ids) && thread_ids.length > 0;
  const hasZendesk = Array.isArray(zendesk_tickets) && zendesk_tickets.length > 0;
  if (!hasEmails && !hasThreads && !hasZendesk) {
    return NextResponse.json({ error: "emails, thread_ids, or zendesk_tickets required" }, { status: 400 });
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

  let shops;
  try {
    shops = await listScopedShops(supabase, scope, { fields: "id" });
  } catch (err) {
    return NextResponse.json({ error: `Shop lookup failed: ${err.message}` }, { status: 500 });
  }
  const shop = shops[0];
  if (!shop?.id) {
    return NextResponse.json({ error: "No shop found for this account" }, { status: 400 });
  }

  const results = [];
  const errors = [];

  // Mode 1: pasted emails — generate draft then judge
  if (hasEmails) {
    for (const email of emails) {
      const ticketBody = email.body?.trim();
      const ticketSubject = email.subject?.trim() || null;
      if (!ticketBody) continue;
      try {
        const { draft, actions, confidence, sources, routingHint, latencyMs } = pipeline === "v2"
          ? await generateDraftV2(shop.id, ticketSubject, ticketBody, v2Options)
          : await generateDraft(shop.id, ticketSubject, ticketBody);
        const scores = await judgeWithOpenAI(ticketBody, draft, null, judge_model);
        const { data: inserted } = await supabase
          .from("eval_results")
          .insert({
            shop_id: shop.id,
            thread_id: null,
            run_label,
            model,
            pipeline_version: pipeline,
            ticket_subject: ticketSubject,
            ticket_body: ticketBody.slice(0, 2000),
            draft_content: draft.slice(0, 2000),
            proposed_actions: actions.length > 0 ? actions : null,
            verifier_confidence: confidence,
            sources: sources.length > 0 ? sources : null,
            routing_hint: routingHint,
            latency_ms: latencyMs,
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

  // Mode 3: zendesk_tickets — generate draft + compare vs human reply
  if (hasZendesk) {
    for (const ticket of zendesk_tickets) {
      const ticketBody = String(ticket.customer_body || ticket.body || "").trim();
      const ticketSubject = String(ticket.subject || "").trim() || null;
      const humanReply = String(ticket.human_reply || "").trim() || null;
      const conversationHistory = String(ticket.conversation_history || "").trim() || null;
      const zendeskId = String(ticket.id || "");
      if (!ticketBody) continue;

      // Include prior conversation turns so generate-draft-unified has full context
      const fullBody = conversationHistory
        ? `[Previous conversation:\n${conversationHistory}\n]\n\n${ticketBody}`
        : ticketBody;

      try {
        const { draft, actions, confidence, sources, routingHint, latencyMs } = pipeline === "v2"
          ? await generateDraftV2(shop.id, ticketSubject, fullBody, v2Options)
          : await generateDraft(shop.id, ticketSubject, fullBody);
        const scores = await judgeWithOpenAI(fullBody, draft, humanReply, judge_model);
        const { data: inserted } = await supabase
          .from("eval_results")
          .insert({
            shop_id: shop.id,
            thread_id: null,
            run_label,
            model,
            pipeline_version: pipeline,
            ticket_subject: ticketSubject,
            ticket_body: ticketBody.slice(0, 2000),
            draft_content: draft.slice(0, 2000),
            proposed_actions: actions.length > 0 ? actions : null,
            verifier_confidence: confidence,
            sources: sources.length > 0 ? sources : null,
            routing_hint: routingHint,
            latency_ms: latencyMs,
            human_reply: humanReply ? humanReply.slice(0, 2000) : null,
            zendesk_ticket_id: zendeskId || null,
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

        const scores = await judgeWithOpenAI(customerMsg.body, draftMsg.body, null, judge_model);
        const { data: inserted } = await supabase
          .from("eval_results")
          .insert({
            shop_id: shop.id,
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
