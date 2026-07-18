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
import { FactResolverResult, type OrderMatchState } from "./fact-resolver.ts";
import { RetrieverResult } from "./retriever.ts";
import { callOpenAIJson } from "./openai-json.ts";
import {
  type ActionMode,
  resolveActionMode,
} from "../../_shared/action-modes.ts";

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

// The ONLY genuinely read-only, side-effect-free order-action proposals. Every
// other action either mutates Shopify, sends a customer-facing message, or
// writes data (note/tag), so none of them are safe on an unconfirmed order.
// `requires_approval` is NOT a safe signal here — e.g. initiate_return carries
// requires_approval=false yet mutates — so we use an explicit allowlist.
const READ_ONLY_LOOKUP_ACTIONS: ReadonlySet<string> = new Set([
  "lookup_order_status",
  "fetch_tracking",
]);

export function isReadOnlyLookupAction(type: string): boolean {
  return READ_ONLY_LOOKUP_ACTIONS.has(String(type || "").trim());
}

// Per-match-state action policy:
//   "all"              → exact order number: any proposal may flow (via approval)
//   "read_only_lookup" → single email match: ONLY read-only lookups allowed
//   "none"             → every other state (incl. an absent/undefined match):
//                        block ALL order-action proposals (fail-safe)
export type MatchActionPolicy = "all" | "read_only_lookup" | "none";

export function actionPolicyForMatch(
  state: OrderMatchState | undefined,
): MatchActionPolicy {
  switch (state) {
    case "exact_order_number":
      return "all";
    case "single_email_match":
      return "read_only_lookup";
    // multiple_email_matches | order_not_found | integration_error |
    // missing_identifiers | undefined → no verified, confirmed order → no actions.
    default:
      return "none";
  }
}

// Applies the match-state policy to a proposal list. Fail-safe by construction:
// an absent match collapses to "none".
export function applyMatchActionPolicy(
  proposals: ActionProposal[],
  state: OrderMatchState | undefined,
): ActionProposal[] {
  const policy = actionPolicyForMatch(state);
  if (policy === "all") return proposals;
  if (policy === "none") return [];
  return proposals.filter((p) => isReadOnlyLookupAction(p.type));
}

// Per-shop action konfiguration — læst fra shops.action_config JSONB.
// Alle felter er valgfrie med fornuftige defaults.
export interface ShopActionConfig {
  // Canonical permission per core action. Missing values keep the legacy-safe
  // defaults; "off" removes the proposal entirely.
  action_modes?: Partial<Record<
    | "update_shipping_address"
    | "cancel_order"
    | "refund_order"
    | "initiate_return"
    | "create_exchange_request",
    ActionMode
  >>;

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

// Genkender tekniske symptomer — bruges til at undgå at foreslå exchange på første kontakt
// for problemer der kan løses med troubleshooting.
const TECHNICAL_ISSUE_RE =
  /\b(connect|pair|pairing|dongle|firmware|app|sound|audio|lyd|bluetooth|usb|static|dropout|crackling|noise|battery|charging|mic|microphone|lag|delay|forbind|lydudfald|støj|opladning|batteri|mikrofon|app|disconnect|afkobl|tilslut|fejl|problem|not work|virker\s+ikke|duer\s+ikke|fejlfind|virker\s+ikke|stutter|stuttering)\b/i;

function isTechnicalIssue(
  customerMessage: string,
  plan: Plan,
): boolean {
  return TECHNICAL_ISSUE_RE.test(customerMessage) ||
    plan.sub_queries.some((q) => TECHNICAL_ISSUE_RE.test(q));
}

// Er der allerede forsøgt troubleshooting i denne samtale?
// Tjekker pending_asks og decisions_made for tegn på at vi allerede har givet trin.
function hasAlreadyTroubleshot(caseState: CaseState, customerMessage = ""): boolean {
  const allContext = [
    ...caseState.decisions_made.map((d) => d.decision),
    ...caseState.pending_asks,
    ...caseState.open_questions,
  ].join(" ");
  const contextMatch =
    /troubleshoot|fejlfind|trin|steps|reset|nulstil|firmware|update|opdater|prøv\s+disse|try\s+the|follow|fulgte|forsøgt|already\s+tried|allerede\s+prøvet/i
      .test(allContext);
  // Fang eksplicit "jeg har prøvet alt" i selve kundebeskedens tekst
  const messageMatch =
    /\b(already\s+tried|tried\s+all|tried\s+every|tried\s+the\s+steps|done\s+everything|followed\s+all|allerede\s+prøvet|prøvet\s+alle?|fulgt\s+alle?|gjort\s+alt|har\s+prøvet\s+alt|tried\s+all\s+the\s+steps|tried\s+all\s+your|tried\s+everything)\b/i
      .test(customerMessage);
  return contextMatch || messageMatch;
}

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

const GLOBALLY_DISABLED_ACTIONS = new Set([
  "add_internal_note_or_tag",
  "add_note",
  "add_tag",
  "resend_confirmation_or_invoice",
  "change_shipping_method",
  "hold_or_release_fulfillment",
  "edit_line_items",
  "update_customer_contact",
]);

function isActionDisabled(
  type: string,
  shopConfig: ShopActionConfig,
): boolean {
  const actionMode = resolveActionMode(type, shopConfig);
  if (actionMode) return actionMode === "off";
  if (GLOBALLY_DISABLED_ACTIONS.has(type)) return true;
  return shopConfig.disabled_actions?.includes(type) ?? false;
}

function alreadyDecided(
  keys: Set<string>,
  ...decisionKeys: string[]
): boolean {
  return decisionKeys.some((k) => keys.has(k));
}

function photoConfirmed(caseState: CaseState): boolean {
  return caseState.decisions_made.some((d) =>
    /photo[_\s]?confirmed|photo[_\s]?received|photos[_\s]?provided|billede[_\s]?modtaget|documentation[_\s]?received/i
      .test(d.decision)
  );
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

// ─── LLM adresse-ekstraktion (fallback når regex-parser fejler) ──────────────

async function extractAddressWithLLM(
  message: string,
  existingShipping: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  const existing = existingShipping || {};
  const fallbackCountry = String(existing.country || "");
  const existingName = [existing.first_name, existing.last_name]
    .map((v) => String(v || "").trim())
    .filter(Boolean)
    .join(" ");

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      address1: { type: "string" },
      address2: { type: "string" },
      city: { type: "string" },
      zip: { type: "string" },
      country: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
    },
    required: ["address1", "address2", "city", "zip", "country", "name", "phone"],
  };

  try {
    const parsed = await callOpenAIJson<Record<string, string>>({
      model: Deno.env.get("OPENAI_EXTRACT_MODEL") ?? "gpt-4o-mini",
      systemPrompt:
        `Extract the new shipping address from the customer message. Return empty string for fields you cannot determine. Use the existing fallback values where indicated.`,
      userPrompt:
        `Customer message: "${message.slice(0, 600)}"
Existing recipient name (fallback if no name in message): "${existingName}"
Existing country (fallback if no country in message): "${fallbackCountry}"

Extract the shipping address the customer wants to use. Return JSON with: address1, address2 (empty string if none), city, zip, country, name (empty string if unknown), phone (empty string if unknown).`,
      maxTokens: 200,
      schema,
      schemaName: "address_extraction",
    });

    if (!parsed?.address1 || !parsed?.city || !parsed?.zip) return null;
    return {
      address1: parsed.address1,
      address2: parsed.address2 || null,
      city: parsed.city,
      zip: parsed.zip,
      country: parsed.country || fallbackCountry,
      name: parsed.name || existingName || null,
      phone: parsed.phone || String(existing.phone || "") || null,
    };
  } catch {
    return null;
  }
}

// ─── Deterministiske regler ───────────────────────────────────────────────────

export function applyDeterministicRules(
  plan: Plan,
  caseState: CaseState,
  facts: FactResolverResult,
  retrieved: RetrieverResult,
  shopConfig: ShopActionConfig,
  customerMessage = "",
  preExtractedAddress: Record<string, unknown> | null = null,
): ActionProposal[] {
  const order = facts.order;
  const factMap: Record<string, string> = {};
  for (const f of facts.facts) factMap[f.label] = f.value;
  const decided = new Set(caseState.decisions_made.map((d) => d.decision));
  const intent = plan.primary_intent;

  // ── 1. Ren information — ingen action nødvendig ────────────────────────────
  // Writer henter fakta og KB og svarer direkte.
  if (["tracking", "product_question", "thanks", "update", "other"].includes(intent)) {
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

  // ── Guard: pending asks — vi venter på information fra kunden ──────────────
  // Hvis pending_asks ikke er tom, er vi i informationsindsamlings-mode.
  // Action-decision må ikke foreslå resolution-actions (exchange, refund, return)
  // før vi har fået den afventede information. Writer håndterer opfølgningen.
  const RESOLUTION_INTENTS = new Set([
    "exchange", "complaint", "refund", "return", "cancel",
  ]);
  if (
    caseState.pending_asks.length > 0 &&
    RESOLUTION_INTENTS.has(intent)
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
        const shippingAddress = preExtractedAddress;
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
          requires_approval:
            resolveActionMode("update_shipping_address", shopConfig) !== "auto",
        }];
      }
    }
    // Afsendt → ingen action, writer forklarer at det er for sent
    return [];
  }

  // ── 3. Returanmodning ──────────────────────────────────────────────────────
  if (intent === "return") {
    if (
      alreadyDecided(
        decided,
        "return_offered",
        "initiate_return",
        "send_return_instructions",
      )
    ) return [];
    if (!order) return [];

    const eligibility = factMap["Returret"] ?? "";
    if (
      eligibility.startsWith("Ja") &&
      !isActionDisabled("initiate_return", shopConfig)
    ) {
      return [{
        type: "send_return_instructions",
        confidence: "high",
        reason: `Ordre inden for returvinduet: ${eligibility}`,
        params: { order_id: order.id, order_name: order.name },
        requires_approval: true,
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
      return [{
        type: "refund_order",
        confidence: "medium",
        reason: "Kunden anmoder om refundering på betalt ordre",
        params: { order_id: order.id, order_name: order.name },
        // Refund auto-execution stays locked until amount/line-item limits are
        // part of the canonical policy.
        requires_approval: true,
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
        confidence: "high",
        reason: "Kunden ønsker annullering og ordren er endnu ikke afsendt",
        params: { order_id: order.id, order_name: order.name },
        requires_approval: resolveActionMode("cancel_order", shopConfig) !== "auto",
      }];
    }
    // Afsendt → ingen annullering mulig, writer forklarer
    return [];
  }

  // ── 5b. Faktura / ordrebekræftelse gensendelse ────────────────────────────
  // Håndteres som "other" intent — kunden beder om et dokument, ikke penge tilbage.
  if (intent === "other") {
    const msg = String(
      (caseState.open_questions ?? []).join(" ") + " " +
      (plan.sub_queries ?? []).join(" "),
    ).toLowerCase();
    const INVOICE_RE =
      /\b(faktura|invoice|receipt|kvittering|ordrebekræftelse|order confirmation|resend|gensend|eftersend)\b/i;
    const bodyText = String(
      plan.sub_queries?.join(" ") ?? "",
    ).toLowerCase();
    // Tjek sub_queries, open_questions OG selve kundebeskedens tekst direkte
    if (
      INVOICE_RE.test(msg) || INVOICE_RE.test(bodyText) || INVOICE_RE.test(customerMessage)
    ) {
      if (order && !alreadyDecided(decided, "resend_confirmation_or_invoice") && !isActionDisabled("resend_confirmation_or_invoice", shopConfig)) {
        return [{
          type: "resend_confirmation_or_invoice",
          confidence: "high",
          reason: "Kunden beder om gensendelse af faktura eller ordrebekræftelse",
          params: { order_id: order.id, order_name: order.name },
          requires_approval: false,
        }];
      }
    }
    return [];
  }

  // ── 6. Exchange (ombytning) ────────────────────────────────────────────────
  if (intent === "exchange") {
    if (
      alreadyDecided(decided, "exchange_offered", "create_exchange_request")
    ) return [];

    // Guard: foreslå IKKE exchange på første kontakt hvis det er et teknisk problem.
    // Troubleshooting skal altid forsøges først — exchange foreslås kun når troubleshooting er forsøgt.
    // Undtagelse: fysisk skade (broken, cracked, fallen off) = troubleshooting giver ikke mening.
    const hasPhysicalDamage =
      /\b(broken|broke|crack|cracked|fallen\s+off|fell\s+off|physical|bent|ødelagt|knækket|revne|knæk|bøjet|faldet\s+af|beskadiget)\b/i
        .test(customerMessage);
    if (isTechnicalIssue(customerMessage, plan) && !hasPhysicalDamage && !hasAlreadyTroubleshot(caseState, customerMessage)) {
      // Lad writer give troubleshooting-trin fra KB i stedet for at springe til exchange
      return [];
    }

    // Guard: shop kræver foto/dokumentation FØR exchange foreslås
    if (shopConfig.defect_requires_photo && !photoConfirmed(caseState)) {
      return []; // Writer beder om billeder — exchange foreslås i næste runde
    }

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

    if (useOfficeFlow && !isActionDisabled("add_note", shopConfig)) {
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
      (officeFromKB || sparePartsWorkflow === "office") &&
      !isActionDisabled("add_note", shopConfig)
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

    // Guard: foreslå IKKE exchange på første kontakt for tekniske problemer.
    // Fx lyd-udfald, forbindelsesproblemer, app-problemer osv. → troubleshooting først.
    // Undtagelse: fysisk skade (broken, cracked) → exchange kan foreslås.
    const hasPhysicalDamageComplaint =
      /\b(broken|broke|crack|cracked|fallen\s+off|fell\s+off|physical|bent|ødelagt|knækket|revne|knæk|bøjet|faldet\s+af|beskadiget)\b/i
        .test(customerMessage);
    if (
      isTechnicalIssue(customerMessage, plan) &&
      !hasPhysicalDamageComplaint &&
      !hasAlreadyTroubleshot(caseState, customerMessage) &&
      !sparePartInCustomerWords
    ) {
      return []; // Writer giver troubleshooting-trin fra KB
    }

    // Guard: shop kræver foto/dokumentation FØR exchange foreslås
    if (shopConfig.defect_requires_photo && !photoConfirmed(caseState)) {
      return []; // Writer beder om billeder — exchange foreslås i næste runde
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

export function computeRoutingHint(
  proposals: ActionProposal[],
  plan: Plan,
): "auto" | "review" | "block" {
  // Planner uncertainty or an explicit human-escalation resolution must never
  // become auto merely because no structured action was proposed.
  if (plan.resolution_stage === "escalate_human") return "review";
  if (!Number.isFinite(plan.confidence) || plan.confidence < 0.65) {
    return "review";
  }

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
  // Pre-ekstraher adresse for address_change intent: regex → LLM fallback.
  // Gøres her (async context) så applyDeterministicRules forbliver synkron.
  let preExtractedAddress: Record<string, unknown> | null = null;
  if (plan.primary_intent === "address_change" && facts.order) {
    const regexResult = extractReplacementShippingAddress(
      customerMessage,
      facts.order.shipping_address as Record<string, unknown> | null | undefined,
    );
    if (regexResult?.address1 && regexResult?.city && regexResult?.zip) {
      preExtractedAddress = regexResult;
    } else {
      preExtractedAddress = await extractAddressWithLLM(
        customerMessage,
        facts.order.shipping_address as Record<string, unknown> | null | undefined,
      );
      if (preExtractedAddress) {
        console.log("[action-decision] address extracted via LLM fallback");
      }
    }
  }

  // 1. Deterministiske regler med per-shop config og KB-overrides
  let proposals = applyDeterministicRules(
    plan,
    caseState,
    facts,
    retrieved,
    shopConfig,
    customerMessage,
    preExtractedAddress,
  );

  // 2. LLM fallback:
  //    a) intent er "other" og planner har identificeret relevante skills
  //    b) ELLER: deterministiske regler gav ingen forslag men der er skills at overveje
  const shouldUseLlmFallback = proposals.length === 0 &&
    plan.skills_to_consider.length > 0 &&
    !["tracking", "product_question", "thanks", "update"].includes(plan.primary_intent);

  if (shouldUseLlmFallback) {
    proposals = await llmFallbackActions(plan, caseState, facts, shopConfig);
  }

  // Safety gate: apply the order-match action policy. Covers BOTH the
  // deterministic and LLM-fallback paths. Fail-safe — an absent match collapses
  // to "none", so only an exact order number (full) or a single email match
  // (read-only lookups only) can ever carry proposals through. Read-only lookup
  // failures (order=null → unsafe states) can never seed a proposal.
  // generate-draft-v2 stays propose-only.
  const before = proposals.length;
  proposals = applyMatchActionPolicy(proposals, facts.match?.state);
  if (before !== proposals.length) {
    console.log(
      `[action-decision] order_match=${facts.match?.state ?? "absent"} policy=${
        actionPolicyForMatch(facts.match?.state)
      } — stripped ${before - proposals.length} proposal(s)`,
    );
  }

  const routing_hint = computeRoutingHint(proposals, plan);

  console.log(
    `[action-decision] intent=${plan.primary_intent} proposals=${
      proposals.map((p) => p.type).join(",") || "none"
    } routing=${routing_hint}`,
  );

  return { proposals, routing_hint };
}
