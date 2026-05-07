// supabase/functions/generate-draft-v2/stages/action-decision.ts
//
// Action-decision stage — bestemmer hvilke Shopify-actions der skal foreslås.
//
// Arkitektur:
//   1. Deterministiske regler (plan + facts + shopConfig) — ingen LLM
//   2. KB-baserede overrides (retrieved chunks) — tolker shop-specifikke procedurer
//   3. LLM fallback — kun til edge cases der ikke er dækket af regler
//
// Per-shop tilpasning sker via ShopActionConfig (læst fra shops.action_config JSONB).
// Nye webshops får fornuftige defaults — ingen kodeændringer nødvendige ved onboarding.
//
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import { FactResolverResult } from "./fact-resolver.ts";
import { RetrieverResult } from "./retriever.ts";
import { callOpenAIJson } from "./openai-json.ts";

// ─── Typer ────────────────────────────────────────────────────────────────────

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

// Per-shop action konfiguration — læst fra shops.action_config JSONB.
// Alle felter er valgfrie med fornuftige defaults.
export interface ShopActionConfig {
  // Hvordan håndteres reservedels-anmodninger (kabler, dongler, ørepuder osv.)?
  // "office"  → sendes fra kontoret — tilføj note til ordre, ingen Shopify exchange (AceZone-model)
  // "shopify" → opret Shopify exchange (standard for de fleste shops)
  // "manual"  → ingen automatisk action, ruter til menneskelig vurdering
  spare_parts_workflow?: "office" | "shopify" | "manual";

  // Nøgleord der identificerer reservedele for denne shop.
  // Supplerer den generelle SPARE_PART_RE regex.
  spare_part_keywords?: string[];

  // Hvordan håndteres produktombytninger (ikke reservedele)?
  // "shopify" → create_exchange_request (default)
  // "manual"  → routing til menneske, ingen action
  exchange_workflow?: "shopify" | "manual";

  // Kræves der foto/dokumentation FØR defekt-sag behandles?
  defect_requires_photo?: boolean;

  // Kan adresseændringer udføres automatisk (uden godkendelse)?
  address_change_auto?: boolean;

  // Maksimalt antal dage fra ordredato hvor refund kan foreslås.
  // 0 = altid kræv godkendelse (default), 30 = auto inden for 30 dage.
  refund_auto_days?: number;

  // Actions der er deaktiverede for denne shop (fx fordi integrationen ikke understøtter dem).
  disabled_actions?: string[];
}

export interface ActionDecisionInput {
  plan: Plan;
  caseState: CaseState;
  facts: FactResolverResult;
  retrieved: RetrieverResult; // KB-chunks til at tolke shop-specifikke procedurer
  shopConfig: ShopActionConfig; // Per-shop konfiguration
  customerMessage?: string;
}

const ACTION_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reason: { type: "string" },
          requires_approval: { type: "boolean" },
        },
        required: ["type", "confidence", "reason", "requires_approval"],
      },
    },
  },
  required: ["proposals"],
};

// ─── Hjælpefunktioner ─────────────────────────────────────────────────────────

// Standard reservedels-nøgleord — gælder på tværs af headset-shops.
// Suppleres af shopConfig.spare_part_keywords per shop.
const DEFAULT_SPARE_PART_RE =
  /\b(cable|kabel|ladekabel|usb.?c|dongle|ear.?pad|cushion|ørepude|pude|spare.?part|reservedel|charging.?cable|ladestik)\b/i;

function isSparePartRequest(
  plan: Plan,
  caseState: CaseState,
  shopConfig: ShopActionConfig,
): boolean {
  const context = [
    ...caseState.entities.products_mentioned,
    ...caseState.open_questions,
    ...plan.sub_queries,
  ].join(" ");

  if (DEFAULT_SPARE_PART_RE.test(context)) return true;

  if (shopConfig.spare_part_keywords?.length) {
    const shopRe = new RegExp(
      shopConfig.spare_part_keywords.map((k) =>
        k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("|"),
      "i",
    );
    if (shopRe.test(context)) return true;
  }

  return false;
}

// Tjek om retrieved KB-chunks indikerer office-forsendelse
// (KB siger eksplicit at noget ikke må gå via Shopify).
const KB_OFFICE_RE =
  /from.*office|office.*ship|not.*through.*shopify|not.*shopify|spare.*part.*office|send.*from.*our.*office/i;

function kbSaysOfficeShipment(retrieved: RetrieverResult): boolean {
  return retrieved.chunks.some((c) => KB_OFFICE_RE.test(c.content));
}

function isActionDisabled(
  type: string,
  shopConfig: ShopActionConfig,
): boolean {
  return shopConfig.disabled_actions?.includes(type) ?? false;
}

function alreadyDecided(
  keys: Set<string>,
  ...decisionKeys: string[]
): boolean {
  return decisionKeys.some((k) => keys.has(k));
}

function normalizeCandidate(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractReplacementShippingAddress(
  message: string,
  existingShipping: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const lines = String(message || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const joined = lines.join(" ");
  if (
    !/\b(address|adresse|leveringsadresse|ship to|send(?:es)? til|street|road|avenue|ave|city|by|zip|postal|postnummer|country|land)\b/i
      .test(joined)
  ) {
    return null;
  }

  const contentLines = lines.filter((line) =>
    !/^(?:hello|hi|hej|dear|thanks|thank you|tak|mvh|venlig hilsen)\b[,!.\s]*.*$/i.test(line) &&
    !/\b(?:kan i|can you|jeg har|i have|ordren|order|det er)\b/i.test(line)
  );
  const fieldValue = (patterns: RegExp[]) => {
    for (const line of contentLines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match?.[1]) return normalizeCandidate(match[1]);
      }
    }
    return "";
  };
  const streetLikeLines = contentLines.filter((line) =>
    /^(?!.*\b(?:city|by|zip(?: code)?|postal code|postnummer|country|land|phone|telefon|name|navn)\s*:).*(?:\d+[A-Za-z0-9 -]{0,8}\s+)?(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|drive|dr\.?|lane|ln\.?|way|apartment|apt|suite|unit|floor|sal|vej|gade|all[eé]|plads|stræde|vaenge|vænge)\b/i
      .test(line) ||
    /\b[A-Za-zÆØÅæøåÄÖÜäöüß .'-]+(?:vej|gade|all[eé]|plads|stræde|vaenge|vænge)\s+\d+[A-Za-z0-9 ,.-]*$/i
      .test(line) ||
    /^(?:address|adresse|street|address1|address 1)\s*:/i.test(line)
  );
  const zipCityLine = contentLines.find((line) => /^[A-Z]{0,3}-?\d{3,10}\s+\S.+$/i.test(line)) || "";
  const zipCityMatch = zipCityLine.match(/^([A-Z]{0,3}-?\d{3,10})\s+(.+)$/i);
  const streetIndex = streetLikeLines.length ? contentLines.indexOf(streetLikeLines[0]) : -1;
  const possibleName = streetIndex > 0 ? normalizeCandidate(contentLines[streetIndex - 1] || "") : "";
  const countryLine = contentLines.find((line) =>
    /^(?:danmark|denmark|sverige|sweden|norge|norway|germany|tyskland|us|usa|united states)$/i.test(line)
  ) || "";

  const address1 = fieldValue([
    /^(?:address1|address 1|address|adresse|street)\s*:\s*(.+)$/i,
  ]) || normalizeCandidate(streetLikeLines[0] || "");
  if (!address1) return null;

  const existing = existingShipping || {};
  const existingName = [
    existing.first_name,
    existing.last_name,
  ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");

  return {
    name: fieldValue([/^(?:name|full name|recipient|navn|modtager)\s*:\s*(.+)$/i]) ||
      possibleName || existingName || null,
    address1,
    address2: fieldValue([/^(?:address2|address 2|suite|unit|apartment|apt)\s*:\s*(.+)$/i]) ||
      normalizeCandidate(streetLikeLines[1] || "") || null,
    zip: fieldValue([/^(?:zip(?: code)?|postal code|postcode|post code|postnummer)\s*:\s*(.+)$/i]) ||
      zipCityMatch?.[1]?.trim() || "",
    city: fieldValue([/^(?:city|town|by)\s*:\s*(.+)$/i]) || zipCityMatch?.[2]?.trim() || "",
    country: fieldValue([/^(?:country|land)\s*:\s*(.+)$/i]) || normalizeCandidate(countryLine) ||
      String(existing.country || ""),
    phone: fieldValue([/^(?:phone|telephone|mobile|telefon)\s*:\s*(.+)$/i]) ||
      String(existing.phone || "") || null,
  };
}

// ─── Deterministiske regler ───────────────────────────────────────────────────

function applyDeterministicRules(
  plan: Plan,
  caseState: CaseState,
  facts: FactResolverResult,
  retrieved: RetrieverResult,
  shopConfig: ShopActionConfig,
  customerMessage = "",
): ActionProposal[] {
  const order = facts.order;
  const factMap: Record<string, string> = {};
  for (const f of facts.facts) factMap[f.label] = f.value;
  const decided = new Set(caseState.decisions_made.map((d) => d.decision));
  const intent = plan.primary_intent;

  // ── 1. Ren information — ingen action nødvendig ────────────────────────────
  // Writer henter fakta og KB og svarer direkte.
  if (["tracking", "product_question", "thanks", "other"].includes(intent)) {
    return [];
  }

  // ── Guard: Replacement/warranty allerede arrangeret ────────────────────────
  // Hvis decisions_made indeholder en beslutning om garanti-erstatning/ombytning,
  // er sagen allerede håndteret — foreslå IKKE en ny exchange/refund action.
  // Dette forhindrer regression hvor en simpel bekræftelse fejlagtigt udløser
  // create_exchange_request fordi planner klassificerer bekræftelsen som complaint/exchange.
  const replacementAlreadyArranged = [...decided].some((d) =>
    /warranty[_\s]?replacement|replacement[_\s]?offered|manual[_\s]?order|exchange[_\s]?offer|erstatning/i
      .test(d)
  );
  if (
    replacementAlreadyArranged &&
    ["complaint", "exchange", "refund"].includes(intent)
  ) {
    return [];
  }

  // ── 2. Adresseændring ──────────────────────────────────────────────────────
  if (intent === "address_change") {
    if (alreadyDecided(decided, "address_changed", "update_shipping_address")) {
      return []; // Allerede håndteret
    }
    if (!order) return []; // Ingen ordre — writer beder om ordrenummer

    if (
      order.fulfillment_status === null ||
      order.fulfillment_status === "unfulfilled"
    ) {
      if (!isActionDisabled("update_shipping_address", shopConfig)) {
        const shippingAddress = extractReplacementShippingAddress(
          customerMessage,
          order.shipping_address as Record<string, unknown> | null | undefined,
        );
        if (!shippingAddress?.address1 || !shippingAddress?.city || !shippingAddress?.zip) {
          return [];
        }
        return [{
          type: "update_shipping_address",
          confidence: "high",
          reason: "Ordren er ikke afsendt — adressen kan ændres",
          params: {
            order_id: order.id,
            order_name: order.name,
            shipping_address: shippingAddress,
          },
          requires_approval: !(shopConfig.address_change_auto ?? false),
        }];
      }
    }
    // Afsendt → ingen action, writer forklarer at det er for sent
    return [];
  }

  // ── 3. Returanmodning ──────────────────────────────────────────────────────
  if (intent === "return") {
    if (alreadyDecided(decided, "return_offered", "initiate_return")) return [];
    if (!order) return [];

    const eligibility = factMap["Returret"] ?? "";
    if (
      eligibility.startsWith("Ja") &&
      !isActionDisabled("initiate_return", shopConfig)
    ) {
      return [{
        type: "initiate_return",
        confidence: "high",
        reason: `Ordre inden for returvinduet: ${eligibility}`,
        params: { order_id: order.id, order_name: order.name },
        requires_approval: false,
      }];
    }
    // Uden for returvindue eller mangler returret-fakta → ingen action, writer forklarer
    return [];
  }

  // ── 4. Refusionsanmodning ──────────────────────────────────────────────────
  if (intent === "refund") {
    if (alreadyDecided(decided, "refund_offered", "refund_order")) return [];
    if (!order) return [];
    if (isActionDisabled("refund_order", shopConfig)) return [];

    if (order.financial_status === "refunded") return []; // Allerede refunderet

    if (
      order.financial_status === "paid" ||
      order.financial_status === "partially_paid"
    ) {
      // Auto-approve check: er ordren inden for shopConfig.refund_auto_days?
      const autoDays = shopConfig.refund_auto_days ?? 0;
      let requiresApproval = true;
      if (autoDays > 0 && order.created_at) {
        const daysSince = Math.floor(
          (Date.now() - new Date(order.created_at).getTime()) / 86_400_000,
        );
        requiresApproval = daysSince > autoDays;
      }

      return [{
        type: "refund_order",
        confidence: "medium",
        reason: "Kunden anmoder om refundering på betalt ordre",
        params: { order_id: order.id, order_name: order.name },
        requires_approval: requiresApproval,
      }];
    }
    return [];
  }

  // ── 5. Annullering ─────────────────────────────────────────────────────────
  if (intent === "cancel") {
    if (alreadyDecided(decided, "cancel_order", "cancellation_offered")) {
      return [];
    }
    if (!order) return [];
    if (isActionDisabled("cancel_order", shopConfig)) return [];

    if (order.cancelled_at) return []; // Allerede annulleret

    if (
      order.fulfillment_status === null ||
      order.fulfillment_status === "unfulfilled"
    ) {
      return [{
        type: "cancel_order",
        confidence: "medium",
        reason: "Kunden ønsker annullering og ordren er endnu ikke afsendt",
        params: { order_id: order.id, order_name: order.name },
        requires_approval: true,
      }];
    }
    // Afsendt → ingen annullering mulig, writer forklarer
    return [];
  }

  // ── 6. Exchange (ombytning) ────────────────────────────────────────────────
  if (intent === "exchange") {
    if (
      alreadyDecided(decided, "exchange_offered", "create_exchange_request")
    ) return [];

    // Bestem workflow: KB > shopConfig > default (shopify)
    const officeFromKB = kbSaysOfficeShipment(retrieved);
    const sparePartDetected = isSparePartRequest(plan, caseState, shopConfig);
    const sparePartsWorkflow = shopConfig.spare_parts_workflow ?? "shopify";
    const exchangeWorkflow = shopConfig.exchange_workflow ?? "shopify";

    // Kræv BEGGE: spare part detekteret OG office-workflow (KB eller shop config).
    // Forhindrer falsk positiv når KB har "office"-chunks men klagen ikke handler om reservedele.
    const useOfficeFlow = sparePartDetected &&
      (officeFromKB || sparePartsWorkflow === "office");
    const useManualFlow = !useOfficeFlow &&
        (sparePartDetected && sparePartsWorkflow === "manual") ||
      exchangeWorkflow === "manual";

    if (useOfficeFlow) {
      // Reservedel sendes fra kontoret — add_note, ingen Shopify exchange
      const noteText = order
        ? `Spare part requested — ship from office. Order: ${order.name}`
        : "Spare part requested — ship from office (no order found)";
      return [{
        type: "add_note",
        confidence: "high",
        reason: officeFromKB
          ? "KB instruerer office-forsendelse — ikke Shopify exchange"
          : "Reservedel detekteret — sendes fra kontoret per shop-konfiguration",
        params: {
          order_id: order?.id ?? null,
          note: noteText,
        },
        requires_approval: false,
      }];
    }

    if (useManualFlow || !order) {
      // Manuel håndtering — ingen automatisk action, routing til menneske
      return [];
    }

    if (!isActionDisabled("create_exchange_request", shopConfig)) {
      const exchangeVariantId = inferExchangeVariantId(order);
      if (!String(exchangeVariantId || "").trim()) {
        return [];
      }
      return [{
        type: "create_exchange_request",
        confidence: "medium",
        reason: "Kunden ønsker ombytning af produkt",
        params: {
          order_id: order.id,
          order_name: order.name,
          exchange_variant_id: String(exchangeVariantId),
        },
        requires_approval: true,
      }];
    }
    return [];
  }

  // ── 7. Klage ───────────────────────────────────────────────────────────────
  if (intent === "complaint") {
    if (
      alreadyDecided(
        decided,
        "complaint_handled",
        "create_exchange_request",
        "refund_offered",
      )
    ) {
      return [];
    }
    if (!order) return []; // Writer beder om ordreinfo/dokumentation

    // Reservedels-klage (ødelagt kabel, dongle osv.) — samme logik som exchange.
    // VIGTIGT: for klager tjekker vi KUN kundens egne ord (open_questions),
    // IKKE plan.sub_queries som kan indeholde produkt-specifikke ord fra planner.
    const officeFromKB = kbSaysOfficeShipment(retrieved);
    const sparePartsWorkflow = shopConfig.spare_parts_workflow ?? "shopify";
    // Tjek kundens egne ord: products_mentioned + open_questions (IKKE sub_queries — de er planner-infererede)
    const customerWordsOnly = [
      ...caseState.entities.products_mentioned,
      ...caseState.open_questions,
    ].join(" ");
    const sparePartInCustomerWords =
      DEFAULT_SPARE_PART_RE.test(customerWordsOnly) ||
      (shopConfig.spare_part_keywords?.some((k) =>
        new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
          customerWordsOnly,
        )
      ) ?? false);

    if (
      sparePartInCustomerWords &&
      (officeFromKB || sparePartsWorkflow === "office")
    ) {
      return [{
        type: "add_note",
        confidence: "high",
        reason: officeFromKB
          ? "KB instruerer office-forsendelse — ikke Shopify exchange"
          : "Reservedel detekteret — sendes fra kontoret per shop-konfiguration",
        params: {
          order_id: order.id,
          note:
            `Spare part complaint — ship replacement from office. Order: ${order.name}`,
        },
        requires_approval: false,
      }];
    }

    // Generel klage (manglende vare, forkert vare, defekt produkt)
    // → foreslå exchange så mennesket kan se og godkende
    if (!isActionDisabled("create_exchange_request", shopConfig)) {
      const exchangeVariantId = inferExchangeVariantId(order);
      if (!String(exchangeVariantId || "").trim()) {
        return [];
      }
      return [{
        type: "create_exchange_request",
        confidence: "low",
        reason:
          "Klage over produkt — kræver menneskelig vurdering og godkendelse",
        params: {
          order_id: order.id,
          order_name: order.name,
          exchange_variant_id: String(exchangeVariantId),
        },
        requires_approval: true,
      }];
    }
    return [];
  }

  return [];
}

// ─── LLM fallback ─────────────────────────────────────────────────────────────
// Bruges til "other"-intent med skills_to_consider, eller når deterministiske
// regler ikke producerede forslag men planner identificerede relevante skills.

async function llmFallbackActions(
  plan: Plan,
  caseState: CaseState,
  facts: FactResolverResult,
  shopConfig: ShopActionConfig,
): Promise<ActionProposal[]> {
  const allowedSkills = plan.skills_to_consider.filter(
    (s) => !isActionDisabled(s, shopConfig),
  );
  if (allowedSkills.length === 0) return [];

  const factsText = facts.facts.length > 0
    ? facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "Ingen verificerede fakta tilgængelige";
  const context = [
    ...caseState.open_questions,
    ...caseState.pending_asks,
  ].join("; ") || "Ingen åbne spørgsmål";

  try {
    const parsed = await callOpenAIJson<
      { proposals?: Record<string, unknown>[] }
    >({
      model: Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini",
      systemPrompt:
        `You are a conservative support action selector. Only suggest actions you are highly confident are needed. Empty list is always safe. Output valid JSON only.`,
      userPrompt: `Customer situation: ${context}

Verified order facts:
${factsText}

Available actions for this shop: ${allowedSkills.join(", ")}

Return JSON:
{
  "proposals": [
    {
      "type": "<action_type from available actions>",
      "confidence": "high|medium|low",
      "reason": "<short reason in Danish>",
      "requires_approval": true
    }
  ]
}

Only include actions directly necessary. Empty proposals array is fine.`,
      maxTokens: 500,
      schema: ACTION_DECISION_SCHEMA,
      schemaName: "draft_v2_action_decision",
    });

    if (!Array.isArray(parsed?.proposals)) return [];

    return parsed.proposals
      .filter((p: Record<string, unknown>) =>
        typeof p.type === "string" &&
        allowedSkills.includes(p.type) &&
        !isActionDisabled(String(p.type), shopConfig)
      )
      .map((p: Record<string, unknown>) => ({
        type: String(p.type),
        confidence: (["high", "medium", "low"].includes(String(p.confidence))
          ? p.confidence
          : "low") as "high" | "medium" | "low",
        reason: String(p.reason ?? ""),
        params: {},
        requires_approval: p.requires_approval !== false,
      }));
  } catch {
    return [];
  }
}

// ─── Routing ──────────────────────────────────────────────────────────────────

function computeRoutingHint(
  proposals: ActionProposal[],
  plan: Plan,
): "auto" | "review" | "block" {
  // Klager og exchanges kræver altid menneskelig vurdering
  if (plan.primary_intent === "complaint") return "review";
  if (plan.primary_intent === "exchange") return "review";

  // Actions med godkendelseskrav → review
  if (proposals.some((p) => p.requires_approval)) return "review";

  // Lav-confidence → review
  if (proposals.some((p) => p.confidence === "low")) return "review";

  // Ingen actions eller alle er high-confidence uden approval → auto er mulig
  return "auto";
}

function inferExchangeVariantId(order: unknown): string {
  const record = (order || {}) as Record<string, unknown>;
  const direct =
    record.exchange_variant_id ||
    record.exchangeVariantId ||
    record.variant_id ||
    record.variantId ||
    "";
  if (String(direct || "").trim()) return String(direct);
  const lineItems = Array.isArray(record.line_items) ? record.line_items : [];
  const variantIds = Array.from(
    new Set(
      lineItems
        .map((item) => String((item as Record<string, unknown>)?.variant_id || "").trim())
        .filter(Boolean),
    ),
  );
  return variantIds.length === 1 ? variantIds[0] : "";
}

// ─── Indgang ──────────────────────────────────────────────────────────────────

export async function runActionDecision(
  { plan, caseState, facts, retrieved, shopConfig, customerMessage = "" }: ActionDecisionInput,
): Promise<ActionDecisionResult> {
  // 1. Deterministiske regler med per-shop config og KB-overrides
  let proposals = applyDeterministicRules(
    plan,
    caseState,
    facts,
    retrieved,
    shopConfig,
    customerMessage,
  );

  // 2. LLM fallback:
  //    a) intent er "other" og planner har identificeret relevante skills
  //    b) ELLER: deterministiske regler gav ingen forslag men der er skills at overveje
  const shouldUseLlmFallback = proposals.length === 0 &&
    plan.skills_to_consider.length > 0 &&
    !["tracking", "product_question", "thanks"].includes(plan.primary_intent);

  if (shouldUseLlmFallback) {
    proposals = await llmFallbackActions(plan, caseState, facts, shopConfig);
  }

  const routing_hint = computeRoutingHint(proposals, plan);

  console.log(
    `[action-decision] intent=${plan.primary_intent} proposals=${
      proposals.map((p) => p.type).join(",") || "none"
    } routing=${routing_hint}`,
  );

  return { proposals, routing_hint };
}
