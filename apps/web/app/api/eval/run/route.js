import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { listScopedShops, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const JUDGE_SYSTEM_PROMPT =
  `You are an expert customer service quality evaluator.
You will be given a customer support ticket and a draft response written by an AI.
Score the draft on four dimensions, each from 1 to 10:

- correctness: Are the steps/information accurate and appropriate for the specific product and issue described?
- completeness: Are all necessary steps or information included? Nothing important missing?
- tone: Is the response professional, empathetic, and appropriately warm?
- actionability: Can the customer immediately act on this response without needing more info?

overall_10: Your holistic score (1-10) for whether a support agent could send this as-is without editing.
10 means a senior human agent could send it as-is.

Important: Some evaluated outputs intentionally pause before a customer-facing reply because an action needs human approval.
If the AI output says it paused for action approval, judge whether the proposed action/routing is correct. Do not score it as "no response provided" just because the final customer reply comes after approval.

Return ONLY valid JSON, no markdown:
{
  "correctness": <1-10>,
  "completeness": <1-10>,
  "tone": <1-10>,
  "actionability": <1-10>,
  "overall_10": <1-10>,
  "send_ready": true|false,
  "primary_gap": "short label",
  "missing_for_10": ["concrete missing thing"],
  "likely_root_cause": "retrieval|facts|intent|conversation_state|policy|writer|language|action_decision|eval_harness|other",
  "reasoning": "<1-2 sentences explaining the overall score>"
}`;

const JUDGE_WITH_HUMAN_PROMPT =
  `You are an expert customer service quality evaluator.
You will be given a customer support ticket, an AI-generated draft response, and the actual response a human support agent sent.
Treat the human response as a strong reference answer, but not as something to copy blindly. Ignore signatures, greetings, and minor wording differences.
Score whether the AI draft is send-ready compared with the human response on four dimensions, each from 1 to 10:

- correctness: Does the AI answer the customer's actual request and avoid unsupported facts?
- completeness: Does the AI cover the same essential resolution/next-step points as the human reply, without adding irrelevant extras?
- tone: Is the AI's tone appropriate for the customer's situation and at least as natural as the human reply?
- actionability: Does the AI make the next step or outcome as clear as the human reply?

overall_10: Your holistic score (1-10) for sendability. 10 = the AI draft is as good as or better than the human reply and could be sent as-is. 6 = useful but needs edits. 1 = wrong or unsafe.

Important: Some evaluated outputs intentionally pause before a customer-facing reply because an action needs human approval.
If the AI output says it paused for action approval, judge whether the proposed action/routing is correct. Do not score it as "no response provided" just because the final customer reply comes after approval.

Return ONLY valid JSON, no markdown:
{
  "correctness": <1-10>,
  "completeness": <1-10>,
  "tone": <1-10>,
  "actionability": <1-10>,
  "overall_10": <1-10>,
  "send_ready": true|false,
  "primary_gap": "short label",
  "missing_for_10": ["concrete missing thing"],
  "likely_root_cause": "retrieval|facts|intent|conversation_state|policy|writer|language|action_decision|eval_harness|other",
  "reasoning": "<1-2 sentences naming the concrete gap or why it is send-ready>"
}`;

const JUDGE_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-5-mini",
  "gpt-5-nano",
]);

function normalizeJudgeModel(model) {
  return JUDGE_MODELS.has(model) ? model : "gpt-4o-mini";
}

function draftForJudge(draftContent, actions = []) {
  const draft = String(draftContent || "").trim();
  if (draft) return draft;
  if (Array.isArray(actions) && actions.length > 0) {
    return `[The pipeline correctly paused before sending a customer-facing draft because it proposed ${
      actions.length
    } action(s) requiring ticket-side approval. Evaluate whether this is the right action and routing decision, not as a missing customer reply.]`;
  }
  return draft;
}

async function judgeWithOpenAI(
  ticketBody,
  draftContent,
  humanReply = null,
  judgeModel = "gpt-4o-mini",
) {
  const systemPrompt = humanReply
    ? JUDGE_WITH_HUMAN_PROMPT
    : JUDGE_SYSTEM_PROMPT;
  const userPrompt = humanReply
    ? `CUSTOMER TICKET:\n${ticketBody}\n\nHUMAN AGENT REPLY:\n${humanReply}\n\nAI DRAFT:\n${draftContent}`
    : `CUSTOMER TICKET:\n${ticketBody}\n\nDRAFT RESPONSE:\n${draftContent}`;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
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
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  const clamp10 = (value) =>
    Math.max(1, Math.min(10, Math.round(Number(value) || 1)));
  const toFive = (value) =>
    Math.max(1, Math.min(5, Math.round(clamp10(value) / 2)));
  const overall10 = clamp10(parsed.overall_10 ?? parsed.overall);
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
        ...(INTERNAL_AGENT_SECRET
          ? { "x-internal-secret": INTERNAL_AGENT_SECRET }
          : {}),
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
    throw new Error(
      `Could not reach generate-draft-unified: ${fetchErr.message}`,
    );
  }
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(
      `generate-draft-unified ${res.status}: ${
        data?.error || raw.slice(0, 200)
      }`,
    );
  }
  const draft = String(data?.reply || "").trim();
  if (!draft) {
    throw new Error(
      `generate-draft-unified returned no reply. Raw: ${raw.slice(0, 300)}`,
    );
  }
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  return {
    draft,
    actions,
    confidence: null,
    sources: [],
    routingHint: null,
    latencyMs: Date.now() - startTime,
  };
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
          conversation_history: options.conversationHistory || undefined,
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
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(
      `generate-draft-v2 ${res.status}: ${data?.error || raw.slice(0, 200)}`,
    );
  }
  const actions = Array.isArray(data?.proposed_actions)
    ? data.proposed_actions
    : [];
  const draft = String(data?.draft_text || "").trim();
  if (!draft && actions.length === 0) {
    throw new Error(
      `generate-draft-v2 returned no draft. Raw: ${raw.slice(0, 300)}`,
    );
  }
  const confidence = data?.confidence ?? null;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const routingHint = data?.routing_hint ?? null;
  const latencyMs = Number.isFinite(Number(data?.latency_ms))
    ? Number(data.latency_ms)
    : Date.now() - startTime;
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
    strong_model = "gpt-5",
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
  const hasZendesk = Array.isArray(zendesk_tickets) &&
    zendesk_tickets.length > 0;
  if (!hasEmails && !hasThreads && !hasZendesk) {
    return NextResponse.json({
      error: "emails, thread_ids, or zendesk_tickets required",
    }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, {
      status: 500,
    });
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
    return NextResponse.json({ error: `Shop lookup failed: ${err.message}` }, {
      status: 500,
    });
  }
  const shop = shops[0];
  if (!shop?.id) {
    return NextResponse.json({ error: "No shop found for this account" }, {
      status: 400,
    });
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
        const { draft, actions, confidence, sources, routingHint, latencyMs } =
          pipeline === "v2"
            ? await generateDraftV2(
              shop.id,
              ticketSubject,
              ticketBody,
              v2Options,
            )
            : await generateDraft(shop.id, ticketSubject, ticketBody);
        const scores = await judgeWithOpenAI(
          ticketBody,
          draftForJudge(draft, actions),
          null,
          judge_model,
        );
        const { data: inserted, error: insertError } = await supabase
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
            overall_10: scores.overall_10,
            send_ready: scores.send_ready,
            primary_gap: scores.primary_gap,
            missing_for_10: scores.missing_for_10,
            likely_root_cause: scores.likely_root_cause,
            reasoning: scores.reasoning,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
        results.push({
          subject: ticketSubject,
          id: inserted?.id,
          scores,
          draft,
        });
      } catch (err) {
        errors.push({ subject: ticketSubject, error: err.message });
      }
    }
  }

  // Mode 3: zendesk_tickets — generate draft + compare vs human reply
  if (hasZendesk) {
    for (const ticket of zendesk_tickets) {
      const ticketBody = String(ticket.customer_body || ticket.body || "")
        .trim();
      const ticketSubject = String(ticket.subject || "").trim() || null;
      const humanReply = String(ticket.human_reply || "").trim() || null;
      const conversationHistory =
        String(ticket.conversation_history || "").trim() || null;
      const zendeskId = String(ticket.id || "");
      if (!ticketBody) continue;

      // Include prior conversation turns so generate-draft-unified has full context
      try {
        const { draft, actions, confidence, sources, routingHint, latencyMs } =
          pipeline === "v2"
            ? await generateDraftV2(shop.id, ticketSubject, ticketBody, {
              ...v2Options,
              conversationHistory,
            })
            : await generateDraft(
              shop.id,
              ticketSubject,
              conversationHistory
                ? `[Previous conversation:\n${conversationHistory}\n]\n\n${ticketBody}`
                : ticketBody,
            );
        const judgeBody = conversationHistory
          ? `[Previous conversation:\n${conversationHistory}\n]\n\n${ticketBody}`
          : ticketBody;
        const scores = await judgeWithOpenAI(
          judgeBody,
          draftForJudge(draft, actions),
          humanReply,
          judge_model,
        );
        const { data: inserted, error: insertError } = await supabase
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
            overall_10: scores.overall_10,
            send_ready: scores.send_ready,
            primary_gap: scores.primary_gap,
            missing_for_10: scores.missing_for_10,
            likely_root_cause: scores.likely_root_cause,
            reasoning: scores.reasoning,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
        results.push({
          subject: ticketSubject,
          id: inserted?.id,
          scores,
          draft,
        });
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

        if (!draftMsg?.body) {
          errors.push({ thread_id: threadId, error: "No draft found" });
          continue;
        }

        const { data: customerMsg } = await supabase
          .from("mail_messages")
          .select("body, subject")
          .eq("thread_id", threadId)
          .eq("from_me", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!customerMsg?.body) {
          errors.push({ thread_id: threadId, error: "No customer message" });
          continue;
        }

        const scores = await judgeWithOpenAI(
          customerMsg.body,
          draftMsg.body,
          null,
          judge_model,
        );
        const { data: inserted, error: insertError } = await supabase
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
            overall_10: scores.overall_10,
            send_ready: scores.send_ready,
            primary_gap: scores.primary_gap,
            missing_for_10: scores.missing_for_10,
            likely_root_cause: scores.likely_root_cause,
            reasoning: scores.reasoning,
          })
          .select("id")
          .single();
        if (insertError) throw new Error(`eval_results insert failed: ${insertError.message}`);
        results.push({ thread_id: threadId, id: inserted?.id, scores });
      } catch (err) {
        errors.push({ thread_id: threadId, error: err.message });
      }
    }
  }

  const avg = (key) =>
    results.length > 0
      ? Math.round(
        (results.reduce((s, r) => s + (r.scores[key] || 0), 0) /
          results.length) * 10,
      ) / 10
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
      overall_10: avg("overall_10"),
    },
    results,
  });
}
