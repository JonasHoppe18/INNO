import { detectHardCapSignals } from "./judge-hardcaps.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
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

NON-NEGOTIABLE HARD CAPS — these OVERRIDE everything above (including any instruction not to penalize missing actions). Set the flag AND cap the score:
- FABRICATION: If the AI invents a person, team, process, policy, address, or a commitment/action not supported by the ticket or known facts (e.g. naming a colleague, a "sales leads team", or a return-label process never established), set "fabrication": true and cap overall at 2. This is a safety failure.
  Examples: "I'll notify the team handling X so <Name> is informed" when that team/person is not in the ticket → fabrication. Naming an internal department/colleague/process that was never established → fabrication, even if it looks like a helpful handoff.
- UNSUPPORTED AVAILABILITY: If the AI states or implies a product, variant, or spare part is in stock / purchasable / restockable without that being given as a fact, set "unsupported_availability": true and cap overall at 3.
  Examples: "we offer these earpads as spare parts on our webshop" plus a purchase/spare-parts link, or "it's in stock / you can buy it / I'll reserve a set", when no live stock fact is given → unsupported_availability=true, even if you then ask which country/order to "confirm stock".
- WRONG LANGUAGE: If the reply language does not match the customer's language, set "language_mismatch": true and cap overall at 2.
- WRONG DIRECTION (multi-turn): If the conversation already established a direction and the AI reverses or restarts it (e.g. re-asks "what do you need help with?"), set "wrong_direction": true and cap overall at 3.
- UNNECESSARY ESCALATION/HEDGING: If the AI defers ("I'll get back to you", "we'll look into it / forward this") when it had enough to resolve or to ask one precise question, set "unnecessary_escalation": true and drop overall by 2.

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
  "likely_root_cause": "retrieval|facts|intent|conversation_state|policy|writer|language|action_decision|clarification|unnecessary_escalation|eval_harness|other",
  "fabrication": false,
  "unsupported_availability": false,
  "language_mismatch": false,
  "wrong_direction": false,
  "unnecessary_escalation": false,
  "reasoning": "<1-2 sentences explaining the overall score>"
}`;

const JUDGE_WITH_HUMAN_PROMPT =
  `You are an expert customer service quality evaluator.
You will be given a customer support ticket, an AI-generated draft response, and the actual response a human support agent sent.
Treat the human response as a strong reference answer, but not as something to copy blindly. Ignore signatures, greetings, and minor wording differences.

CRITICAL — live data divergence:
The AI draft is generated NOW and may call live tools (shipping carriers like GLS, Shopify order status, current stock levels). The human reply was written WHEN the ticket originally arrived and reflects the state at that time. When the AI's facts differ from the human reply because the underlying reality has moved on (e.g. AI says "delivered May 13" where human said "shipped today"; AI says "in stock" where human said "sold out"), this is NOT a correctness failure — the AI is reporting current truth. Only penalise correctness when the AI states something that is verifiably wrong about the customer's situation at the time the AI is answering, or when it contradicts facts present in the ticket itself (order number, product name, customer's described problem).
If you cannot tell whether a fact divergence is live-data drift or a real error, do NOT penalise correctness — set likely_root_cause to "eval_harness" and note it in reasoning.

Score whether the AI draft is send-ready compared with the human response on four dimensions, each from 1 to 10:

- correctness: Does the AI answer the customer's actual request using facts that are accurate at the time of answering? Live-data divergence from the human reply is NOT an error (see above).
- completeness: Does the AI cover the same essential resolution/next-step points as the human reply, without adding irrelevant extras?
- tone: Is the AI's tone appropriate for the customer's situation and at least as natural as the human reply?
- actionability: Does the AI make the next step or outcome as clear as the human reply?

overall_10: Your holistic score (1-10) for sendability. Use these anchors strictly — do NOT inflate a draft just because it reads fluently or sounds professional:
- 9-10: Reaches the SAME resolution the human did and is send-ready with no edits. Reserve 10 for drafts as good as or better than the human.
- 7-8: Right resolution, but a human would make minor edits (small wording, one missing non-critical detail).
- 5-6: Right topic but the resolution is incomplete, partly wrong, or materially more verbose than the human while saying less — a human would substantially rewrite it.
- 3-4: Pursues the WRONG resolution, would mislead the customer, or omits the core thing the customer needs.
- 1-2: Wrong, unsafe, or off-topic.

NON-NEGOTIABLE HARD CAPS — these OVERRIDE everything above (including any instruction not to penalize missing actions). Set the flag AND cap the score:
- RESOLUTION MISMATCH: If the human resolves the case one way and the AI proposes a different path that is wrong or worse (e.g. DIY/self-repair instead of sending a replacement; an in-house warranty swap when the human says a third-party reseller is responsible; troubleshooting the wrong subsystem), cap overall at 4.
- MISSING INFO THE HUMAN COLLECTED: If the human asks for specific information needed to proceed (shipping/label details, order number, name used at purchase, photos) and the AI does not, cap overall at 6 and name it in missing_for_10.
- VERBOSITY: If the AI is materially longer than the human while the human was concise and complete, drop overall by 1-2 and set primary_gap to "too verbose".
- INVENTED CONTENT / FABRICATION: If the AI gives steps, specs, numbers, advice, OR invents a person, team, process, policy, address, or commitment not supported by the ticket, the human reply, or known product facts, set "fabrication": true and cap overall at 2 (this is a safety failure, not a style issue).
  Examples: "I'll notify the team handling X so <Name> is informed" when that team/person is not in the ticket/human reply → fabrication. Naming an internal department/colleague/process that was never established → fabrication, even if it looks like a helpful handoff.
- UNSUPPORTED AVAILABILITY: If the AI states or implies a product, variant, or spare part is in stock / purchasable / restockable without that being given as a fact, set "unsupported_availability": true and cap overall at 3.
  Examples: "we offer these earpads as spare parts on our webshop" plus a purchase/spare-parts link, or "it's in stock / you can buy it / I'll reserve a set", when no live stock fact is given → unsupported_availability=true, even if you then ask which country/order to "confirm stock".
- WRONG LANGUAGE: If the reply language does not match the customer's language, set "language_mismatch": true and cap overall at 2.
- WRONG DIRECTION (multi-turn): If the conversation already established a direction and the AI reverses or restarts it (e.g. tells the customer to return an item when the shop was sending a replacement, or re-asks "what do you need help with?"), set "wrong_direction": true and cap overall at 3.
- UNNECESSARY ESCALATION/HEDGING: If the AI defers ("I'll get back to you", "we'll look into it / forward this") when it had enough to resolve or to ask one precise question, set "unnecessary_escalation": true and drop overall by 2.

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
  "likely_root_cause": "retrieval|facts|intent|conversation_state|policy|writer|language|action_decision|clarification|unnecessary_escalation|eval_harness|other",
  "fabrication": false,
  "unsupported_availability": false,
  "language_mismatch": false,
  "wrong_direction": false,
  "unnecessary_escalation": false,
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

const ACTION_REQUIRED_NOTE =
  `\n\nIMPORTANT (action_required case): The human agent performed or requested an out-of-band action ` +
  `(created a shipment, issued a refund, asked for SWIFT/IBAN or shipping identity, activated a code) ` +
  `that the AI has no tool or fact access to. Do NOT penalize the AI for not performing that action. ` +
  `Score only whether the AI's reply is a correct, safe, send-ready customer-service reply (e.g. asking ` +
  `the right single clarifying question).` +
  `\n\nHARD CAPS ARE NON-NEGOTIABLE AND APPLY WITH FULL FORCE HERE TOO — the "do not penalize" rule above ` +
  `NEVER overrides them. In particular: inventing a team, person, department, or process to hand off to is ` +
  `FABRICATION (set fabrication=true, cap overall<=2) EVEN IF it reads as a helpful action; claiming a ` +
  `product/part is available, in stock, or purchasable (or linking a buy/spare-parts page as if buyable) ` +
  `without a stated fact is UNSUPPORTED AVAILABILITY (set unsupported_availability=true, cap overall<=3) ` +
  `EVEN IF you then ask for order/shipping details.`;

async function judgeWithOpenAI(
  ticketBody,
  draftContent,
  humanReply = null,
  judgeModel = "gpt-4o-mini",
  anchorClass = "comparable",
) {
  const basePrompt = humanReply
    ? JUDGE_WITH_HUMAN_PROMPT
    : JUDGE_SYSTEM_PROMPT;
  const systemPrompt = anchorClass === "action_required"
    ? basePrompt + ACTION_REQUIRED_NOTE
    : basePrompt;
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
      max_tokens: 400,
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

  // Deterministic hard-cap enforcement: the model is told to set these flags and
  // cap itself, but it under-recalls them (especially in action_required cases),
  // so we (a) OR in a high-precision deterministic detector and (b) re-apply the
  // caps in code, so a fluent-but-unsafe draft can never slip through.
  const detected = detectHardCapSignals(draftContent, {
    ticketBody,
    humanReply: humanReply || "",
  });
  const judge_flags = {
    fabrication: parsed.fabrication === true || detected.fabrication,
    unsupported_availability:
      parsed.unsupported_availability === true || detected.unsupported_availability,
    language_mismatch: parsed.language_mismatch === true,
    wrong_direction: parsed.wrong_direction === true,
    unnecessary_escalation: parsed.unnecessary_escalation === true,
  };
  let capped = overall10;
  if (judge_flags.fabrication) capped = Math.min(capped, 2);
  if (judge_flags.unsupported_availability) capped = Math.min(capped, 3);
  if (judge_flags.language_mismatch) capped = Math.min(capped, 2);
  if (judge_flags.wrong_direction) capped = Math.min(capped, 3);
  if (judge_flags.unnecessary_escalation) capped = Math.max(1, capped - 2);

  const anyHardFlag = judge_flags.fabrication ||
    judge_flags.unsupported_availability ||
    judge_flags.language_mismatch ||
    judge_flags.wrong_direction;

  return {
    correctness: toFive(parsed.correctness),
    completeness: toFive(parsed.completeness),
    tone: toFive(parsed.tone),
    actionability: toFive(parsed.actionability),
    overall: toFive(capped),
    overall_10: capped,
    send_ready: (parsed.send_ready === true || capped >= 9) && !anyHardFlag,
    primary_gap: String(parsed.primary_gap || "").trim() || null,
    missing_for_10: Array.isArray(parsed.missing_for_10)
      ? parsed.missing_for_10.map((item) => String(item)).filter(Boolean)
      : [],
    likely_root_cause: String(parsed.likely_root_cause || "").trim() || null,
    judge_flags,
    reasoning: String(parsed.reasoning || "").trim(),
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildSafetyFromGenerateDraftV2Response(data) {
  const routingHint = typeof data?.routing_hint === "string" ? data.routing_hint : null;
  const blockSendRecommended = typeof data?.block_send_recommended === "boolean"
    ? data.block_send_recommended
    : null;
  const unsupportedChecks = {};
  if (isPlainObject(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (
        key.startsWith("unsupported_") &&
        key.endsWith("_check") &&
        isPlainObject(value)
      ) {
        unsupportedChecks[key] = value;
      }
    }
  }
  return {
    routing_hint: routingHint,
    block_send_recommended: blockSendRecommended,
    live_fact_action_claim_check: isPlainObject(data?.live_fact_action_claim_check)
      ? data.live_fact_action_claim_check
      : null,
    unsupported_commitment_check: isPlainObject(data?.unsupported_commitment_check)
      ? data.unsupported_commitment_check
      : null,
    unsupported_assumption_check: isPlainObject(data?.unsupported_assumption_check)
      ? data.unsupported_assumption_check
      : null,
    ...unsupportedChecks,
    guardrails: isPlainObject(data?.provenance) && Array.isArray(data.provenance.guardrails)
      ? data.provenance.guardrails
      : null,
  };
}

async function generateDraftV2(shopId, subject, emailBody, options = {}) {
  const startTime = Date.now();
  const endpoint = `${SUPABASE_URL}/functions/v1/generate-draft-v2`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      // The edge function normally answers in 10-30s; a lost connection
      // otherwise hangs eval/probe scripts forever (observed 54+ min).
      signal: AbortSignal.timeout(120_000),
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
          // Exclude the source ticket from few-shot retrieval so eval scores
          // reflect real generalisation, not data leakage.
          source_thread_id: options.sourceThreadId || undefined,
        },
        eval_options: {
          writer_model: options.writerModel || undefined,
          strong_model: options.strongModel || undefined,
          writer_effort: options.writerEffort || undefined,
          disable_escalation: options.disableEscalation === true,
          retrieval_abs_floor:
            typeof options.retrievalAbsFloor === "number"
              ? options.retrievalAbsFloor
              : undefined,
          retrieval_pq_budget:
            typeof options.retrievalPqBudget === "number"
              ? options.retrievalPqBudget
              : undefined,
          retrieval_issue_tiebreak: options.retrievalIssueTiebreak === true
            ? true
            : undefined,
          retrieval_source_consolidate: options.retrievalSourceConsolidate === true
            ? true
            : undefined,
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
  const draft = String(data?.reply || data?.draft_text || "").trim();
  const skipped = data?.skipped === true;
  // A paused/skipped run is a legitimate pipeline outcome (action needs approval,
  // or routing short-circuit). Only treat an empty draft as an error when nothing
  // else explains it, so the gold runner can still record skip outcomes.
  const proposedActions = Array.isArray(data?.proposed_actions)
    ? data.proposed_actions
    : Array.isArray(data?.actions)
      ? data.actions
      : [];
  if (!draft && !skipped && proposedActions.length === 0) {
    throw new Error(
      `generate-draft-v2 returned no reply. Raw: ${raw.slice(0, 300)}`,
    );
  }
  const actions = proposedActions;
  const confidence = typeof data?.confidence === "number" ? data.confidence : null;
  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const routingHint = typeof data?.routing_hint === "string" ? data.routing_hint : null;
  const blockSendRecommended = typeof data?.block_send_recommended === "boolean"
    ? data.block_send_recommended
    : null;
  const safety = buildSafetyFromGenerateDraftV2Response(data);
  const retrievalDebug =
    data?.retrieval_debug && Array.isArray(data.retrieval_debug.chunks)
      ? data.retrieval_debug.chunks
      : [];
  const matcherDebug =
    data?.retrieval_debug && data.retrieval_debug.matcher
      ? data.retrieval_debug.matcher
      : null;
  // Eval-only retrieval funnel diagnostics. Already emitted by generate-draft-v2
  // (gated on eval_payload) but previously dropped by the harness. Captured here
  // read-only so the golden runner can show where candidates collapse to zero.
  const candidateDiagnostics =
    data?.retrieval_debug &&
      data.retrieval_debug.candidate_diagnostics &&
      typeof data.retrieval_debug.candidate_diagnostics === "object"
      ? data.retrieval_debug.candidate_diagnostics
      : null;
  return {
    draft,
    actions,
    confidence,
    sources,
    routingHint,
    routing_hint: routingHint,
    blockSendRecommended,
    block_send_recommended: blockSendRecommended,
    safety,
    retrievalDebug,
    matcherDebug,
    candidateDiagnostics,
    // Additive fields — already present in the eval-mode response — so the gold
    // runner can couple by generation_id and grade intent without a second call.
    generationId: typeof data?.generation_id === "string" ? data.generation_id : null,
    intent: typeof data?.intent === "string" ? data.intent : null,
    knowledgeGaps: Array.isArray(data?.knowledge_gaps) ? data.knowledge_gaps : [],
    skipped,
    skipReason: typeof data?.skip_reason === "string" ? data.skip_reason : null,
    latencyMs: Date.now() - startTime,
  };
}

export {
  draftForJudge,
  generateDraftV2,
  buildSafetyFromGenerateDraftV2Response,
  judgeWithOpenAI,
};
