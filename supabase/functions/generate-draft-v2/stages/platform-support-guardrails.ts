// supabase/functions/generate-draft-v2/stages/platform-support-guardrails.ts
//
// Platform-level writer mandate: universal customer-service safety and
// response-quality rules that apply to EVERY shop, rendered deterministically
// into the writer prompt.
//
// Why this exists (and why it is NOT shop knowledge):
// Universal guardrails ("never invent an address", "never promise a refund
// without verified facts") previously leaked into shop-editable Knowledge
// Docs (e.g. an "## Internal guidance" section). That made platform safety
// dependent on each shop writing — and not deleting — the right prose.
// This block is hidden from shops, identical across shops, and versioned in
// code. Shop-editable documents should contain shop-specific FACTS only
// (addresses, windows, procedures); shop-specific behavioral rules live in
// internal rules (stages/internal-rules.ts) or the shop persona.
//
// Pure module: no DB reads, no LLM calls, no shop ids, no per-shop branching.

export const PLATFORM_SUPPORT_GUARDRAILS_BLOCK =
  `# PLATFORM SUPPORT GUARDRAILS — ALWAYS APPLY

- Never invent policy facts, addresses, prices, timelines or operational steps.
- Never promise a refund, exchange, replacement or prepaid return label unless verified facts and the authorized flow support it.
- For a general policy question, answer directly without asking for an order number unless the order is needed to resolve the question.
- If no regional return address is explicitly documented for the customer's country, use the documented default return address. Do not claim that a regional address does not exist unless this is explicitly documented.
- If the customer states that return tracking shows delivery, acknowledge delivery and explain that inspection or processing is the next step. Do not say that the parcel is still awaiting receipt.
- Do not offer a price adjustment or claim that price adjustments are impossible unless a documented policy explicitly supports the statement.
- Do not reopen a question the customer has already answered.
- Do not expose internal labels, enum names, workflow stages or internal reasoning in customer-facing replies.
- When facts are uncertain, ask one focused clarification question or use a safe neutral formulation rather than guessing.`;

/**
 * Render the platform guardrails block for the writer prompt.
 * Deterministic: same output for every shop and every call.
 */
export function buildPlatformSupportGuardrailsBlock(): string {
  return PLATFORM_SUPPORT_GUARDRAILS_BLOCK;
}
