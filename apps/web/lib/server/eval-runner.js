const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";
const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

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
  const draft = String(data?.reply || data?.draft_text || "").trim();
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
  const draft = String(data?.reply || "").trim();
  if (!draft) {
    throw new Error(
      `generate-draft-v2 returned no reply. Raw: ${raw.slice(0, 300)}`,
    );
  }
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  const confidence = typeof data?.confidence === "number" ? data.confidence : null;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const routingHint = typeof data?.routing_hint === "string" ? data.routing_hint : null;
  return {
    draft,
    actions,
    confidence,
    sources,
    routingHint,
    latencyMs: Date.now() - startTime,
  };
}

export {
  draftForJudge,
  generateDraft,
  generateDraftV2,
  judgeWithOpenAI,
};
