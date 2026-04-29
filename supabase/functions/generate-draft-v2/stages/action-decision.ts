// supabase/functions/generate-draft-v2/stages/action-decision.ts
//
// Deterministisk action-decision stage.
// Regler køres over plan + case_state + facts — ingen LLM til kernelogik.
// LLM bruges kun som fallback til edge cases der ikke matcher nogen regel.
//
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import { FactResolverResult } from "./fact-resolver.ts";

export interface ActionProposal {
  type: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  params: Record<string, unknown>;
  requires_approval: boolean;
}

export interface ActionDecisionResult {
  proposals: ActionProposal[];
  routing_hint: "auto" | "review" | "block";
}

export interface ActionDecisionInput {
  plan: Plan;
  caseState: CaseState;
  facts: FactResolverResult;
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Deterministiske regler — køres i prioriteret rækkefølge.
// Returnerer det første sæt forslag der matcher.
function applyDeterministicRules(
  plan: Plan,
  caseState: CaseState,
  facts: FactResolverResult,
): ActionProposal[] {
  const proposals: ActionProposal[] = [];
  const order = facts.order;

  // Byg et hurtigt opslag på facts-labels
  const factMap: Record<string, string> = {};
  for (const f of facts.facts) {
    factMap[f.label] = f.value;
  }

  // Hvad er allerede besluttet/tilbudt i denne samtale
  const decidedKeys = new Set(caseState.decisions_made.map((d) => d.decision));

  const intent = plan.primary_intent;

  // ── 1. Ren informationshenvendelse — ingen action ──────────────────────────
  if (["tracking", "product_question", "thanks", "other"].includes(intent)) {
    return []; // Writeren svarer, ingen action nødvendig
  }

  // ── 2. Returanmodning ──────────────────────────────────────────────────────
  if (intent === "return" && order) {
    const eligibility = factMap["Returret"] ?? "";
    const alreadyOffered = decidedKeys.has("return_offered") ||
      decidedKeys.has("initiate_return");

    if (alreadyOffered) return []; // Undgå gentagelse

    if (eligibility.startsWith("Ja")) {
      proposals.push({
        type: "initiate_return",
        confidence: "high",
        reason: `Ordren er inden for returvinduet (${eligibility})`,
        params: { order_id: order.id, order_name: order.name },
        requires_approval: false,
      });
    }
    // Hvis ikke returret → ingen action, writer forklarer politikken
    return proposals;
  }

  // ── 3. Refusionsanmodning ──────────────────────────────────────────────────
  if (intent === "refund" && order) {
    if (decidedKeys.has("refund_offered") || decidedKeys.has("refund_order")) {
      return [];
    }
    if (
      order.financial_status === "paid" ||
      order.financial_status === "partially_paid"
    ) {
      proposals.push({
        type: "refund_order",
        confidence: "medium",
        reason: "Kunden anmoder om refundering på betalt ordre",
        params: { order_id: order.id, order_name: order.name },
        requires_approval: true,
      });
    }
    return proposals;
  }

  // ── 4. Adresseændring ──────────────────────────────────────────────────────
  if (intent === "address_change" && order) {
    if (
      order.fulfillment_status === null ||
      order.fulfillment_status === "unfulfilled"
    ) {
      proposals.push({
        type: "update_shipping_address",
        confidence: "high",
        reason: "Ordren er ikke afsendt — adressen kan stadig ændres",
        params: { order_id: order.id },
        requires_approval: false,
      });
    } else {
      // Ordren er afsendt — vi kan ikke ændre adressen, writer forklarer
    }
    return proposals;
  }

  // ── 5. Annullering ─────────────────────────────────────────────────────────
  if (intent === "cancel" && order) {
    if (decidedKeys.has("cancel_order") || decidedKeys.has("cancellation_offered")) {
      return [];
    }
    if (
      !order.cancelled_at &&
      (order.fulfillment_status === null ||
        order.fulfillment_status === "unfulfilled")
    ) {
      proposals.push({
        type: "cancel_order",
        confidence: "medium",
        reason: "Kunden ønsker annullering og ordren er ikke afsendt endnu",
        params: { order_id: order.id, order_name: order.name },
        requires_approval: true,
      });
    }
    return proposals;
  }

  // ── 6. Exchange ────────────────────────────────────────────────────────────
  if (intent === "exchange" && order) {
    proposals.push({
      type: "create_exchange_request",
      confidence: "low",
      reason: "Kunden ønsker ombytning — kræver menneskelig vurdering",
      params: { order_id: order.id },
      requires_approval: true,
    });
    return proposals;
  }

  // ── 7. Klage ───────────────────────────────────────────────────────────────
  if (intent === "complaint") {
    // Klag håndteres altid af menneske — ingen auto-action
    return [];
  }

  return proposals;
}

// LLM fallback for edge cases der ikke matchede deterministiske regler.
// Bruges KUN hvis primary_intent er "other" og plan.skills_to_consider ikke er tom.
async function llmFallbackActions(
  plan: Plan,
  caseState: CaseState,
  facts: FactResolverResult,
): Promise<ActionProposal[]> {
  if (plan.skills_to_consider.length === 0) return [];
  if (plan.primary_intent !== "other") return [];

  const factsText = facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  const openQText = caseState.open_questions.join("; ");

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Du er en support action-beslutter. Output KUN gyldigt JSON. Vær konservativ — foreslå kun actions du er sikker på er relevante.`,
          },
          {
            role: "user",
            content: `Kundens spørgsmål: ${openQText}

Verificerede fakta:
${factsText}

Tilgængelige actions: ${plan.skills_to_consider.join(", ")}

Returner JSON:
{
  "proposals": [
    {
      "type": "action_type",
      "confidence": "high|medium|low",
      "reason": "kort begrundelse",
      "requires_approval": true
    }
  ]
}

Returnér kun actions der er direkte relevante. Tom liste er OK.`,
          },
        ],
      }),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return Array.isArray(parsed?.proposals)
      ? parsed.proposals.map((p: Record<string, unknown>) => ({
        type: p.type ?? "unknown",
        confidence: (p.confidence ?? "low") as "high" | "medium" | "low",
        reason: p.reason ?? "",
        params: {},
        requires_approval: p.requires_approval !== false,
      }))
      : [];
  } catch {
    return [];
  }
}

// Bestem routing baseret på forslag + plan.
function computeRoutingHint(
  proposals: ActionProposal[],
  plan: Plan,
): "auto" | "review" | "block" {
  // Klager og exchanges kræver altid menneskelig vurdering
  if (plan.primary_intent === "complaint") return "review";
  if (plan.primary_intent === "exchange") return "review";

  // Actions med requires_approval → review
  if (proposals.some((p) => p.requires_approval)) return "review";

  // Lav-confidence actions → review
  if (proposals.some((p) => p.confidence === "low")) return "review";

  // Ingen problematiske actions → auto er mulig (verificeren sætter endeligt)
  return "auto";
}

export async function runActionDecision(
  { plan, caseState, facts }: ActionDecisionInput,
): Promise<ActionDecisionResult> {
  // 1. Prøv deterministiske regler først
  let proposals = applyDeterministicRules(plan, caseState, facts);

  // 2. LLM fallback kun hvis ingen regler matchede og intent er "other"
  if (proposals.length === 0) {
    proposals = await llmFallbackActions(plan, caseState, facts);
  }

  const routing_hint = computeRoutingHint(proposals, plan);

  return { proposals, routing_hint };
}
