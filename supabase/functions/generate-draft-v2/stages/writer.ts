// supabase/functions/generate-draft-v2/stages/writer.ts
import { Plan } from "./planner.ts";
import { CaseState } from "./case-state-updater.ts";
import { RetrieverResult } from "./retriever.ts";
import { FactResolverResult } from "./fact-resolver.ts";
import { ActionProposal } from "./action-decision.ts";
import { resolveReplyLanguage } from "./language.ts";
import {
  buildVariantGuidanceBlock,
  isVariantConflictingSource,
  resolveSalutationName,
} from "./customer-context.ts";
import { InlineImageAttachment } from "./attachment-loader.ts";

export interface WriterResult {
  draft_text: string;
  proposed_actions: ActionProposal[];
  citations: Array<{ claim: string; source_index: number }>;
}

export interface PolicyContextInput {
  policySummaryText: string;
  policyRulesText: string;
  policyExcerptText: string;
}

export interface WriterInput {
  plan: Plan;
  caseState: CaseState;
  retrieved: RetrieverResult;
  facts: FactResolverResult;
  shop: Record<string, unknown>;
  latestCustomerMessage?: string;
  conversationHistory?: Array<{ role: "customer" | "agent"; text: string }>;
  actionProposals?: ActionProposal[];
  policyContext?: PolicyContextInput;
  model?: string;
  languageCorrectionInstruction?: string;
  attachments?: InlineImageAttachment[];
  actionResult?: Record<string, unknown> | null;
}

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";

const WRITER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply_draft: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          source_index: { type: "number" },
        },
        required: ["claim", "source_index"],
      },
    },
  },
  required: ["reply_draft", "citations"],
};

const LANGUAGE_NAMES: Record<string, string> = {
  da: "dansk",
  sv: "svensk",
  de: "tysk",
  en: "engelsk",
  nl: "hollandsk",
  fr: "fransk",
  no: "norsk",
  fi: "finsk",
  es: "spansk",
  it: "italiensk",
};

const LANGUAGE_LOCALES: Record<string, string> = {
  da: "da-DK",
  sv: "sv-SE",
  de: "de-DE",
  en: "en-US",
  nl: "nl-NL",
  fr: "fr-FR",
  no: "nb-NO",
  fi: "fi-FI",
  es: "es-ES",
  it: "it-IT",
};

function actionResultValue(
  actionResult: Record<string, unknown> | null,
  key: string,
): string {
  const value = actionResult?.[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function formatActionAmountDisplay(
  actionResult: Record<string, unknown> | null,
  replyLanguage: string,
): string {
  const explicitDisplay = actionResultValue(actionResult, "amount_display");
  if (explicitDisplay) return explicitDisplay;

  const amountText = actionResultValue(actionResult, "amount");
  if (!amountText) return "";
  const normalizedAmount = amountText.includes(",")
    ? amountText.replace(/\./g, "").replace(",", ".")
    : amountText;
  const amount = Number(normalizedAmount);
  if (!Number.isFinite(amount)) return amountText;

  const currency = actionResultValue(actionResult, "currency") ||
    actionResultValue(actionResult, "currency_code") ||
    "DKK";
  try {
    return new Intl.NumberFormat(LANGUAGE_LOCALES[replyLanguage] ?? "en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amountText} ${currency}`.trim();
  }
}

function shouldUseResponsesApi(model: string): boolean {
  return /^gpt-5(?:\.|$|-)/.test(model);
}

function extractResponsesText(data: Record<string, unknown>): string {
  const direct = (data as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;

  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown })?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("").trim();
}

const SIGNOFF_LINE_RE =
  /^(?:best regards|kind regards|warm regards|regards|sincerely|thanks|thank you|mvh|venlig hilsen|med venlig hilsen|de bedste hilsner|mange hilsner|hilsen)[,.!]?$/i;

function stripGeneratedSignature(text: string): string {
  const lines = text.replace(/\s+$/u, "").split("\n");
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;

  const min = Math.max(0, end - 5);
  for (let i = end; i >= min; i--) {
    if (SIGNOFF_LINE_RE.test(lines[i].trim())) {
      return lines.slice(0, i).join("\n").replace(/\s+$/u, "");
    }
  }

  return text.trim();
}

function cleanDraftText(text: string): string {
  return stripGeneratedSignature(text)
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(
      /\bordrenummer\s+eller\s+(?:den\s+)?ordre-?email\b/gi,
      "ordrenummer eller hvor headsettet er købt",
    )
    .replace(
      /\bordrenummer\s+eller\s+(?:den\s+)?e-?mail,\s*ordren\s+er\s+bestilt\s+på(?:\s*\([^)]*\))?/gi,
      "ordrenummer eller hvor headsettet er købt",
    )
    .replace(
      /\bordrenummer\s+eller\s+(?:den\s+)?e-?mail\s+ordren\s+er\s+(?:placeret|lavet|bestilt)\s+(?:under|på)\b/gi,
      "ordrenummer eller hvor headsettet er købt",
    )
    .replace(
      /\bordrenummer\s+eller\s+(?:den\s+)?e-?mail,\s*ordren\s+er\s+(?:placeret|lavet|bestilt)\s+(?:under|på)\b/gi,
      "ordrenummer eller hvor headsettet er købt",
    )
    .replace(
      /\border number\s+or\s+(?:the\s+)?order email\b/gi,
      "order number or where the headset was purchased",
    )
    .replace(
      /Når vi har den oplysning, beder vi dig om at vedhæfte et billede af skaden/gi,
      "Vedhæft også et billede af skaden",
    )
    .replace(
      /Vi kan herefter bede om (?:et|en) (?:klart )?(?:foto|billede|video) af skaden til dokumentation, hvis det er nødvendigt\./gi,
      "Vedhæft også et klart foto af skaden, så vi kan dokumentere sagen.",
    )
    .replace(
      /Når vi har den oplysning, åbner vi en garanti\/ombytningssag og beder eventuelt om (?:et|en) (?:klart )?(?:foto|billede|video) af skaden til dokumentation\./gi,
      "Vedhæft også et klart foto af skaden, så vi kan dokumentere sagen og åbne en garanti-/ombytningssag.",
    )
    .replace(/\bReturn for Swap\/warranty-sag\b/g, "garanti-/ombytningssag")
    .replace(
      /\s*If you prefer not to try the steps above and want us to start the review now, tell us and we will escalate immediately\./gi,
      "",
    )
    // Strip any instruction to contact via email — customer is already in the right thread.
    // Catches all forms: "contact us at/via/by email ...", "kontakt(e) os via/på email ..."
    // Removes the entire clause up to the next sentence boundary without inserting a language-specific phrase.
    .replace(
      /[^.!?\n]*(?:contact|reach|email)\s+us\s+(?:at|via|by|on|to)\s+\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:kontakte?\s+os|skriv\s+til\s+os|send\s+(?:en\s+)?(?:mail|e-?mail))\s+(?:via|på|til|at)\s+\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /\s*Because the order shows as shipped and paid, this review requires internal approval;?/gi,
      " Refund reviews require internal approval;",
    )
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function greetingPrefix(language: string): string {
  switch (language) {
    case "da":
    case "no":
      return "Hej";
    case "sv":
      return "Hej";
    case "de":
      return "Hallo";
    case "nl":
      return "Hallo";
    case "fr":
      return "Bonjour";
    case "es":
      return "Hola";
    case "it":
      return "Ciao";
    default:
      return "Hi";
  }
}

function normalizeOpeningGreeting(
  text: string,
  salutationName: string,
  language: string,
): string {
  const draft = text.trim();
  const name = salutationName.trim();
  if (!name) return draft;

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expected = `${greetingPrefix(language)} ${name},`;
  if (
    new RegExp(
      `^(hi|hello|hej|hallo|bonjour|hola|ciao)\\s+${escapedName}\\b`,
      "i",
    ).test(draft)
  ) {
    return draft;
  }
  if (new RegExp(`^${escapedName}\\s*[,\\n]`, "i").test(draft)) {
    return draft.replace(
      new RegExp(`^${escapedName}\\s*,?\\s*`, "i"),
      `${expected}\n\n`,
    );
  }
  return draft;
}

function factValue(facts: FactResolverResult, label: string): string {
  return facts.facts.find((f) => f.label === label)?.value ?? "";
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function extractMessageSignals(messageText: string) {
  const emails = messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ??
    [];
  const orderRefs = [
    ...(messageText.match(/#\d{3,8}\b/g) ?? []),
    ...[...messageText.matchAll(
      /\b(?:order|ordre|command|bestilling)\s*#?\s*(\d{3,8})\b/gi,
    )].map((match) => `#${match[1]}`),
  ];
  const trackingRefs = [
    ...(messageText.match(/\bAWB\s*\d{8,}\b/gi) ?? []),
    ...(messageText.match(/\b\d{10,}\b/g) ?? []),
  ];
  const hasPhone =
    /\b(?:phone|telefon|tlf|mobile|mobil)\s*:?\s*\+?[\d\s().-]{6,}\d\b/i
      .test(messageText) ||
    /\+\d[\d\s().-]{6,}\d\b/.test(messageText);
  const hasDocumentation =
    /\b(attached|attachment|attach|photo|picture|image|video|screenshot|vedhæftet|vedhæft|billede|foto|video)\b/i
      .test(messageText);
  const wantsRefund =
    /\b(refund|money back|reimbursement|pengene tilbage|refusion|refundering)\b/i
      .test(messageText);
  const wantsReturn =
    /\b(return|send back|fortryd|returnere|retur|refund request|set up a refund request)\b/i
      .test(messageText);
  const dissatisfactionReturn =
    /\b(disappointed|unhappy|not satisfied|does not meet|didn't meet|utilfreds|ikke tilfreds|skuffet|meet my expectations|wore .* once|only wore)\b/i
      .test(messageText);
  const hasPurchasePlace =
    /\b(place of purchase|købt|købssted|purchase|purchased|forhandler|retailer|gamebox|official website|webshop|acezone)\b/i
      .test(messageText);
  const hasAccessoryRequest =
    /\b(dongle|usb-c|usb c|charging cable|charger|cable|ear pads?|earpads?|lade\s*kabel|ladekabel|kabel|oplader|reservedel|spare part)\b/i
      .test(messageText) &&
    /\b(lost|forgot|missing|buy|purchase|order|new|replacement|mistet|glemt|mangler|købe|bestille|ny)\b/i
      .test(messageText);
  const hasPhysicalDamage =
    /\b(damaged|damage|broken|crack|cracked|loose|fell off|falling off|physical|skade|ødelagt|knækket|revne|løs|fysisk)\b/i
      .test(messageText);
  const hasTechnicalIssue =
    /\b(connect|connection|pair|paired|app|firmware|update|audio|sound|usb|usb-c|cable|charging|battery|mic|microphone|forbind|forbinde|opdater|lyd|kabel|strøm|batteri|mikrofon)\b/i
      .test(messageText);

  return {
    emails: unique(emails),
    orderRefs: unique(orderRefs),
    trackingRefs: unique(trackingRefs).slice(0, 3),
    hasPhone,
    hasDocumentation,
    wantsRefund,
    wantsReturn,
    dissatisfactionReturn,
    hasPurchasePlace,
    hasAccessoryRequest,
    hasPhysicalDamage,
    hasTechnicalIssue,
  };
}

function buildInfoRequirementsBlock(
  facts: FactResolverResult,
  caseState: CaseState,
  plan: Plan,
  latestCustomerMessage?: string,
): string {
  const known: string[] = [];
  const missing: string[] = [];
  const order = factValue(facts, "Ordre fundet");
  const product = factValue(facts, "Produkter i ordre");
  const customerName = factValue(facts, "Kundenavn");
  const customerEmail = factValue(facts, "Kunde-email kendt") ||
    caseState.entities.customer_email;
  const shippingAddressKnown = factValue(facts, "Leveringsadresse kendt");
  const messageText = latestCustomerMessage ?? "";
  const signals = extractMessageSignals(messageText);
  const hasOrderReference = Boolean(order) ||
    caseState.entities.order_numbers.length > 0 ||
    signals.orderRefs.length > 0;
  const hasEmail = Boolean(customerEmail) || signals.emails.length > 0;

  if (order) known.push(`ordre (${order})`);
  for (const ref of caseState.entities.order_numbers) {
    known.push(`ordrereference fra sagen (${ref})`);
  }
  for (const ref of signals.orderRefs) {
    known.push(`ordre/reference nævnt af kunden (${ref})`);
  }
  if (product) known.push(`produkt (${product})`);
  if (customerName) known.push(`kundenavn (${customerName})`);
  if (customerEmail) known.push(`email (${customerEmail})`);
  for (const email of signals.emails) {
    if (email !== customerEmail) known.push(`email nævnt af kunden (${email})`);
  }
  for (const ref of signals.trackingRefs) {
    known.push(`tracking/AWB-reference nævnt af kunden (${ref})`);
  }
  if (shippingAddressKnown) known.push("leveringsadresse (kendt i systemet)");
  if (signals.wantsRefund) {
    known.push("kundens ønskede løsning (refund/refusion)");
  }

  const policyReturnLike =
    (["refund", "return"].includes(plan.primary_intent) ||
      signals.wantsRefund || signals.wantsReturn) &&
    !signals.hasPhysicalDamage &&
    !signals.hasTechnicalIssue &&
    signals.dissatisfactionReturn;
  const technicalRefundLike =
    (["refund", "return"].includes(plan.primary_intent) ||
      signals.wantsRefund || signals.wantsReturn) &&
    signals.hasTechnicalIssue &&
    !signals.hasPhysicalDamage;
  const warrantyLike = (plan.primary_intent === "exchange" &&
    (!signals.hasTechnicalIssue || signals.hasPhysicalDamage)) ||
    (plan.primary_intent === "refund" && signals.hasPhysicalDamage) ||
    (plan.primary_intent === "complaint" &&
      (signals.hasPhysicalDamage || signals.wantsRefund));
  const orderLookupLike = [
    "tracking",
    "return",
    "refund",
    "exchange",
    "complaint",
    "address_change",
    "cancel",
  ].includes(plan.primary_intent);

  if (signals.hasAccessoryRequest && !hasOrderReference) {
    missing.push(
      "order_reference: ordrenummer, så vi kan tjekke garanti eller finde den rigtige reservedel",
    );
  } else if (warrantyLike) {
    if (!hasOrderReference && !signals.hasPurchasePlace) {
      missing.push(
        "purchase_reference: ordrenummer eller hvor produktet er købt (købssted/forhandler). Spørg aldrig om ordre-email for dette felt",
      );
    }
    if (!signals.hasDocumentation) {
      missing.push(
        "defect_documentation: foto/video der dokumenterer fejlen eller skaden",
      );
    }
    if ((hasOrderReference || signals.hasPurchasePlace) && !signals.hasPhone) {
      missing.push("phone_number: telefonnummer til return/warranty-processen");
    }
  } else if (policyReturnLike) {
    // Policy returns/refunds are not defect claims. Do not ask for defect photos or phone
    // unless a shop-specific policy explicitly requires it.
  } else if (orderLookupLike && !hasOrderReference && !hasEmail) {
    missing.push("order_reference: ordrenummer eller ordre-email");
  }

  if (plan.primary_intent === "address_change") {
    const hasAddressLike =
      /\b\d{1,5}\s+[A-Za-zÆØÅæøåÄÖÜäöüß][\w\s.'-]{2,}\b/.test(messageText) ||
      /\b(address|adresse|gade|street|road|vej|gata|zip|postal|postnummer)\b/i
        .test(messageText);
    if (!hasAddressLike) {
      missing.push("new_shipping_address: den nye leveringsadresse");
    }
  }

  const knownText = known.length
    ? known.map((item) => `- ${item}`).join("\n")
    : "- Ingen sikre kendte oplysninger udover kundens besked";
  const missingText = missing.length
    ? missing.map((item) => `- ${item}`).join("\n")
    : "- none";
  const hasPurchaseReferenceMissing = missing.some((item) =>
    item.startsWith("purchase_reference:")
  );
  const hasDefectDocumentationMissing = missing.some((item) =>
    item.startsWith("defect_documentation:")
  );

  return `# Kendte oplysninger — spørg IKKE kunden om disse
${knownText}

# missing_required_fields — dette er den ENESTE info du må spørge kunden om
${missingText}

Regel: Spørg aldrig kunden om at oplyse, bekræfte eller vælge kendte oplysninger ovenfor. Hvis en proces normalt kræver navn, email, ordre, produkt, adresse eller ønsket løsning, skal du antage at de er kendt og bruge dem internt uden at gengive private adresseoplysninger.
${
    hasPurchaseReferenceMissing
      ? "Når purchase_reference mangler, skal du formulere det som ordrenummer eller hvor produktet/headsettet er købt. Brug aldrig ordre-email som alternativ."
      : ""
  }
${
    hasPurchaseReferenceMissing && hasDefectDocumentationMissing
      ? "Når både purchase_reference og defect_documentation mangler, skal du bede om begge i samme svar, fx ordrenummer eller hvor headsettet er købt samt et foto af skaden. Skriv ikke at foto kun skal sendes senere eller 'hvis nødvendigt'."
      : ""
  }
${
    warrantyLike
      ? "For garanti/refund/defekt-sager skal første prioritet være proof-of-purchase/ordrenummer/købssted og dokumentation (foto/video). Spørg kun om telefonnummer hvis order/proof-of-purchase allerede er kendt, eller kunden allerede har oplyst hvor produktet er købt. Hvis kunden allerede har bedt om refund/refusion, må du ikke bede kunden vælge mellem refund og replacement."
      : ""
  }
${
    policyReturnLike
      ? "Dette ligner en normal return/refund fordi kunden er utilfreds eller har fortrudt uden at beskrive en teknisk fejl, ikke en defekt/warranty-sag. Følg return/refund-policy. Spørg ikke efter defect documentation, foto/video eller telefonnummer medmindre policy eksplicit kræver det."
      : ""
  }
${
    technicalRefundLike
      ? "Kunden nævner refund/return eller er utilfreds, men årsagen er et teknisk problem med produktet. Hvis vidensbasen indeholder relevante troubleshooting-trin, skal du først anerkende refund-ønsket og derefter give troubleshooting-trinene. Skriv at vi går videre med warranty/refund/return review hvis trinene ikke løser problemet. Start ikke med refund review, return address, foto/video eller telefonnummer, medmindre kunden allerede har prøvet alle relevante trin."
      : ""
  }
Hvis missing_required_fields er "none", må du ikke stille kunden et informationsspørgsmål. Skriv i stedet hvad vi gør nu eller at vi vender tilbage med næste skridt.`;
}

export async function runWriter(
  {
    plan,
    caseState,
    retrieved,
    facts,
    shop,
    latestCustomerMessage,
    conversationHistory,
    actionProposals,
    policyContext,
    model,
    languageCorrectionInstruction,
    attachments = [],
    actionResult = null,
  }: WriterInput,
): Promise<WriterResult> {
  const resolvedModel = model ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
  const shopName = (shop as { name?: string }).name ?? "butikken";
  const persona =
    (shop as { persona_instructions?: string; instructions?: string })
      .persona_instructions ??
      (shop as { instructions?: string }).instructions ??
      "";

  const replyLanguage = resolveReplyLanguage(
    latestCustomerMessage ?? "",
    plan.language || caseState.language,
  );
  const langName = LANGUAGE_NAMES[replyLanguage] ?? replyLanguage;
  const salutationName = resolveSalutationName(
    latestCustomerMessage ?? "",
    factValue(facts, "Kundenavn"),
  );
  const salutationBlock = salutationName.name
    ? `# Hilsenavn (deterministisk)
Start svaret med fornavnet "${salutationName.name}".
Kilde: ${salutationName.source}.
${
      salutationName.conflictingOrderName
        ? `Bemærk: ordre-/Shopify-navnet er "${salutationName.conflictingOrderName}", men kundens eget navn i seneste besked vinder for hilsenen. Brug ikke ordre-/Shopify-navnet i hilsenen.`
        : ""
    }`
    : `# Hilsenavn (deterministisk)
Intet sikkert kundenavn til hilsenen. Start med en naturlig neutral hilsen på kundens sprog.`;
  const variantBlock = buildVariantGuidanceBlock(
    latestCustomerMessage ?? "",
    retrieved.chunks.map((chunk) => ({
      source_label: chunk.source_label,
      content: chunk.content,
      kind: chunk.kind,
      usable_as: chunk.usable_as,
    })),
  );
  const chunksForPrompt = retrieved.chunks.filter((chunk) =>
    !isVariantConflictingSource(latestCustomerMessage ?? "", {
      source_label: chunk.source_label,
      content: chunk.content,
      kind: chunk.kind,
      usable_as: chunk.usable_as,
    })
  );

  // --- Few-shot (primær tone-anker — placeres øverst så modellen ser det først) ---
  const fewShotBlock = retrieved.past_ticket_examples.length > 0
    ? `# Eksempler på lignende sager — brug som reference for BÅDE indhold og tone
Disse viser hvad der er det rigtige svar i lignende situationer OG den rette tone og stil. "Korrigeret" betyder at medarbejderen omskrev Sonas udkast markant — det er det stærkeste signal om hvad der forventes. "Bekræftet" betyder Sonas udkast var næsten korrekt:

` +
      retrieved.past_ticket_examples
        .map(
          (ex, i) => {
            const isHeavilyCorrected = ex.csat_score !== null && ex.csat_score < 60;
            const label = ex.csat_score === null
              ? ""
              : isHeavilyCorrected
              ? " [Korrigeret — medarbejder omskrev Sonas svar markant]"
              : ex.csat_score >= 90
              ? " [Bekræftet — Sonas svar var næsten korrekt]"
              : "";
            return `[Eksempel ${i + 1}${label}]
Kunde: "${ex.customer_msg.slice(0, 350)}"
Support svarede: "${ex.agent_reply.slice(0, 500)}"`;
          },
        )
        .join("\n\n")
    : "";

  // --- Verificerede fakta (deterministiske — brug disse frem for viden) ---
  const factsBlock = facts.facts.length > 0
    ? `# Verificerede fakta (brug disse som kilde til faktuelle påstande)
` + facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "";
  const infoRequirementsBlock = buildInfoRequirementsBlock(
    facts,
    caseState,
    plan,
    latestCustomerMessage,
  );

  // --- Shop policy (deterministisk — brug altid disse regler) ---
  const policyBlock = policyContext
    ? [
      policyContext.policyRulesText,
      policyContext.policySummaryText,
      policyContext.policyExcerptText,
    ]
      .filter(Boolean)
      .join("\n\n")
    : "";

  // --- Hvad er allerede besluttet/tilbudt i denne samtale ---
  const decisionsMade = caseState.decisions_made.length > 0
    ? `# Hvad er allerede tilbudt/besluttet i denne samtale
` + caseState.decisions_made.map((d) => `- ${d.decision}`).join("\n")
    : "";

  const pendingAsks = caseState.pending_asks.length > 0
    ? `# Vi venter stadig på fra kunden
` + caseState.pending_asks.map((a) => `- ${a}`).join("\n")
    : "";

  // --- Åbne spørgsmål der SKAL besvares (primær driver for svaret) ---
  const openQBlock = caseState.open_questions.length > 0
    ? `# Kundens åbne spørgsmål — DIT SVAR SKAL BESVARE DISSE (brug fakta til at informere svaret)
` + caseState.open_questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "";

  // --- Foreslåede actions fra deterministisk action-decision ---
  const actionsBlock = actionProposals && actionProposals.length > 0
    ? `# Planlagte actions (deterministisk besluttet — nævn dem naturligt i svaret)
` +
      actionProposals
        .map((a) =>
          `- ${a.type}: ${a.reason}${
            a.requires_approval
              ? " (kræver intern godkendelse — lov ikke kunden at handlingen allerede er udført)"
              : ""
          }`
        )
        .join("\n")
    : "";
  const actionAmountDisplay = formatActionAmountDisplay(actionResult, replyLanguage);
  const actionResultBlock = actionResult
    ? `# POST-ACTION RESULT MODE (primær opgave for dette svar)
Kundens sag er allerede godkendt og handlingen er allerede udført i Shopify. Svaret er derfor en kort bekræftelse til kunden, ikke et forslag, en vurdering eller en ny supportproces.

- action_type: ${String(actionResult.action_type || "")}
- outcome: ${String(actionResult.outcome || "executed")}
- order_name: ${String(actionResult.order_name || actionResult.order_number || "")}
- amount: ${String(actionResult.amount || "")}
- amount_display: ${actionAmountDisplay}
- currency: ${String(actionResult.currency || "")}
- detail: ${String(actionResult.detail || "")}

Regler for post-action-svaret:
- Svar på samme sprog som kunden.
- Brug afsluttet handling-sprog. Skriv at handlingen ER udført, ikke at den kan udføres, bliver behandlet eller vil ske senere.
- Bekræft kun den udførte handling og de relevante fakta ovenfor.
- Ingen signatur, ingen "kontakt os hvis..."-standardlinje, ingen support-email.
- Ingen "tak for din besked" eller generisk varm indledning efter hilsenen — gå direkte til resultatet.
- Forbudte betydninger: "vi kan refundere", "vi har tilbudt en refusion", "vi har igangsat en refusion", "vil blive refunderet", "vil blive tilbageført", "vi behandler refunderingen", "hurtigst muligt", "din anmodning er blevet behandlet", "sagen sendes videre", "venter på godkendelse".
- Hvis action_type er refund_order: skriv at beløbet i amount_display er refunderet for ordren, og at beløbet går tilbage til den oprindelige betalingsmetode. Lov ikke en præcis bankdato medmindre den står eksplicit i facts.`
    : "";

  // --- Viden fra vidensbase ---
  const knowledgeBlock = chunksForPrompt.length > 0
    ? `# Relevant viden fra vidensbasen med kildepolitik
Kildepolitik:
- policy: autoritativ regel fra webshoppen/Shopify policy.
- procedure: følg processen, men spørg kun om felter fra missing_required_fields.
- saved_reply: brug som tone/struktur eller genvej, men den må ikke overrule verificerede fakta, policy eller missing_required_fields.
- tone_example/background: brug kun som kontekst, ikke som sandhed eller proces.
- ignore: må ikke bruges i kundesvaret.
- risk_flags=strong_claim: formulér forsigtigt, medmindre samme claim støttes af policy.
- risk_flags=asks_for_extra_fields: kopier aldrig de ekstra feltkrav; brug kun missing_required_fields.

` +
      chunksForPrompt
        .filter((c) => c.usable_as !== "ignore")
        .map(
          (c, i) =>
            `[kilde ${i}] ${c.source_label}
usable_as: ${c.usable_as}
risk_flags: ${c.risk_flags.length ? c.risk_flags.join(", ") : "none"}
${c.content.slice(0, c.usable_as === "procedure" ? 2500 : 1500)}`,
        )
        .join("\n\n")
    : "";

  const isFollowUp = caseState.decisions_made.length > 0 ||
    caseState.pending_asks.length > 0;

  const systemPrompt = `Du er en erfaren support-medarbejder for ${shopName}.

SPROG (KRITISK — overtager alle andre instruktioner): Svar UDELUKKENDE på ${replyLanguage} (${langName}). Udledt fra kundens seneste besked — ingen persona, ingen vidensbase, ingen eksempler må ændre dette. Hilsen, brødtekst og afslutning skal alle være på nøjagtigt samme sprog. Bland aldrig sprog.
${
    languageCorrectionInstruction
      ? `\nSPROG-CORRECTION MODE (KRITISK): ${languageCorrectionInstruction}\n`
      : ""
  }
${
    actionResult
      ? "\nPOST-ACTION MODE (KRITISK): Handlingens resultat er allerede udført. Skriv et kundesvar der bekræfter det afsluttede resultat i datid/perfektum. Brug ikke fremtid, mulighed, intern behandling eller ny approval. Denne regel overstyrer normal åbning, planlagte actions, knowledge base og persona.\n"
      : ""
  }
${
    persona
      ? `\nBUTIKKENS EGNE INSTRUKTIONER (følg disse præcist, men aldrig på bekostning af sprogrestriktionen ovenfor):\n${persona}\n`
      : ""
  }

DU ER ET MENNESKE: Ingen "Som AI kan jeg...", ingen unødvendige undskyldninger.

HILSEN: Brug hilsenavn-blokken som sandhed. Kundens eget navn i seneste formular/besked/signatur har højere prioritet end Shopify, ordrenavn, billing-navn og shipping-navn. Hvis der ikke er et sikkert hilsenavn, brug blot den enkle hilsen på kundens sprog.

ÅBNING:
${
    actionResult
      ? "- POST-ACTION SVAR — efter hilsenen: gå direkte til bekræftelsen af den udførte handling. Ingen tak-for-besked, ingen empatiåbning, ingen begrundelse."
      : plan.primary_intent === "thanks"
      ? "- TAKSIGELSESSVAR — kunden siger blot tak. Skriv KUN 1-2 sætninger: bekræft at du er glad for at hjælpe, og ønsker dem en god dag. Ingen ordreinfo, ingen tracking, ingen ekstra detaljer."
      : isFollowUp
      ? "- OPFØLGNINGSSVAR — gå direkte til sagen efter hilsenen."
      : "- FØRSTE svar — efter hilsenen: kort varm indledning (tak kunden, vis empati). Gå direkte til løsning — genfortæl IKKE kundens problem med dine egne ord."
  }

AFSLUTNING — vurdér altid situationen, skriv på kundens sprog:
- Konkrete trin givet, afventer resultat fra kunden: "Jeg ser frem til at høre fra dig."
- Problemet løst eller ombytning aftalt: "God dag!"
- Frustreret kunde eller lang ventetid: "Undskyld for ulejligheden og tak for din tålmodighed."
- Brug KUN "Jeg ser frem til at høre fra dig" hvis du aktivt afventer kundens svar — fx vi har bedt om billeder, oplysninger eller afventer resultat af troubleshooting. Brug den ALDRIG som standard-afslutning.
- Aldrig: "er du velkommen til at kontakte os igen" — kunden er allerede i kontakt.
- Skriv ALDRIG "Jeg gennemgår dine oplysninger/fotos internt og vender tilbage", "I'll review this internally", "I'll follow up shortly" eller tilsvarende formuleringer der udskyder beslutningen. Du har to gyldige veje: (1) Hvis alle nødvendige oplysninger er til stede — commit til handlingen direkte: "Vi sender dig et sæt erstatnings-earpads under garantien." (2) Hvis der mangler oplysninger — spørg om præcis det der mangler nu i dette svar. Der er ingen tredje vej hvor du "reviewer internt og vender tilbage".

LÆNGDE OG TONE:
- Vær kortfattet og præcis — undgå fyldord som "Ifølge trackingoplysningerne fra" eller "Du er velkommen til at"
- Kom til sagen: "Din pakke blev leveret den 13. februar kl. 11:13" ikke "Ifølge GLS-data blev pakken leveret..."
- Spejl tonen fra eksemplerne — uformel hvis eksemplerne er uformelle
- Bekræft handlingen — forklar ikke den tekniske årsag bag medmindre kunden har spurgt: "Vi har opdateret adressen" ikke "Vi har opdateret adressen, da ordren endnu ikke er afsendt"
- Brug almindelige sætninger og korte afsnit. Undgå tankestreger/em dashes i kundesvaret. Brug ikke nummererede lister eller bullets, medmindre kunden skal følge en egentlig trin-for-trin procedure.
- Hvis en planlagt action kræver intern godkendelse, må du ikke love at refundering/annullering/ombytning allerede kan gennemføres. Skriv at sagen sendes til gennemgang/videre internt med de fundne ordreoplysninger.

KANAL-REGEL (KRITISK): Bed ALDRIG kunden om at "sende en email", "kontakte os via e-mail på [adresse]", "kontakte os på support@...", "contact us at [email]", "contact us directly" eller skrive til nogen som helst e-mail-adresse. Kunden er allerede i den rigtige supporttråd. Denne regel gælder OGSÅ selvom vidensbasen, en saved reply eller en procedure indeholder en konkret e-mail-adresse som kontaktpunkt — citer aldrig den adresse. Erstat altid med "svar her i tråden" / "reply here in this thread". Hvis kunden skal give info, skriv "svar her i tråden".

URL-REGEL: Skriv URLs som plain text (https://...) — ALDRIG som markdown [tekst](url).

SIGNATUR-REGEL (KRITISK): Skriv ALDRIG signatur, navn, titel, teamnavn eller afsluttende sign-off som "Best regards", "Kind regards", "Regards", "Med venlig hilsen", "Mvh", "Support" osv. Kundens profil/signatur bliver automatisk tilføjet bagefter. Slut i stedet med den sidste relevante servicesætning.

VIDENSBASE-PROCEDURE-REGEL (KRITISK): Hvis vidensbasen indeholder en specifik procedure eller et script til kundens situation, SKAL du følge det præcis — oversæt til kundens sprog, men bevar strukturen og indholdet. Din egen vurdering må ALDRIG erstatte en procedure der er dokumenteret i vidensbasen.

TILSTAND-REGEL (KRITISK): Brug ALDRIG datid ("vi har sendt", "vi har refunderet", "vi har opdateret") for handlinger der ikke eksplicit fremgår af "Planlagte actions", "POST-ACTION RESULT MODE" eller er bekræftet i "Verificerede fakta". Brug nutid/fremtid for det der sker nu: "Vi sender dig", "Vi sørger for", "Vi går videre med". Datid er korrekt når handlingen allerede er registreret som gennemført — fx en leveret pakke med dato eller en udført post-action handling.

BEKRÆFTELSES-REGEL (KRITISK): Når kunden bekræfter noget vi har spurgt om (adresse, oplysninger, situation) med et kort "ja", "ok", "det er korrekt" eller lignende, er svaret enkelt og handlingsorienteret: bekræft hvad der sker nu og hvornår. Genbrug ikke priser, betingelser eller emner der ikke er relevante for det kunden netop bekræftede. Eksempel: kunden bekræfter adresse → "Vi sender dig et nyt kabel til [adresse] hurtigst muligt."

MANUEL-ORDRE-REGEL (KRITISK): Når kunden har bekræftet sine oplysninger til en garantierstatning eller ombytning — uanset om bekræftelsen fremgår af Planlagte actions, decisions_made eller af det citerede indhold i kundens besked (fx "Hvis ja, så kan vi sende dig et nyt under garanti") — og der ikke allerede fremgår af fakta at en ordre er oprettet og sendt, commit altid til: oprette en ordre OG sende tracking-link. Præcis formulering: "Vi opretter en ordre til dig og sender et tracking-link, så snart vores lagerpartner har behandlet og sendt den afsted." Skriv ALDRIG blot "du modtager en opdatering" eller "vi vender tilbage" — vær specifik om tracking-link. Denne regel gælder UANSET om intent er complaint, exchange, other eller noget andet — det afgørende er om kunden netop har bekræftet oplysninger til en igangværende erstatnings-/ombytningsproces.
FORBUDT: "Vi sender dig et nyt [produkt]" / "We will send you a new" / "Vi fremsender" alene — disse er IKKE acceptable alene. ENESTE gyldige format er at starte med "Vi opretter en ordre til dig og sender et tracking-link". "Vi sender" uden "Vi opretter en ordre" overtræder denne regel.

OPFØLGNINGS-REGEL (KRITISK): Tjek decisions_made i samtalehistorikken FØR du skriver. Hvis en tidligere agent-besked allerede har arrangeret noget (back-order, forsendelse, manuel ordre, tredjepartsforespørgsel), er kundens nuværende besked en opfølgning på den aftale — IKKE en ny anmodning. Svar direkte:
- "Hvornår betaler jeg?" / "Hvordan udfylder jeg adressen?" efter back-order-aftale → forklar at vi kontakter dem med faktura og leveringsoplysninger, når varen er på lager igen. De behøver ikke gøre noget nu.
- "Er ordren sendt?" / "Er den på vej?" efter "shipping arranged ASAP" → bekræft at det er sat i gang, og at de modtager tracking-link
- "Hvorfor bad I om X?" → forklar præcis årsagen fra vores udgående besked — ikke en generisk forklaring

BACK-ORDER-FAKTURA-REGEL (KRITISK): Når kunden stiller opfølgningsspørgsmål om betaling eller adresseudfyldelse i en back-order/forudbestillingssituation ("Hvornår betaler jeg?", "Hvordan udfylder jeg adressen?", "How do I pay?", "Where do I fill in my address?") — svar SPECIFIKT på HOW og WHEN:
- Angiv præcist hvornår fakturaen/betalingslinket sendes (fx "Vi sender dig en faktura i juli når varen er klar")
- Angiv betalingsmetode hvis den fremgår af policy (fx "Betaling sker via [metode]") — ellers skriv at fakturaen indeholder betalingsinstruktioner
- Angiv at leveringsadressen udfyldes ved modtagelse af fakturaen — kunden behøver ikke gøre noget nu
- FORBUDT: "Vi kontakter dig i juli" alene uden at forklare hvad der sker ved den kontakt. Kunden spørger specifikt om HOW — svar på det.

GENTAGELSES-REGEL (KRITISK): Tjek samtalehistorikken INDEN du foreslår en løsning. Hvis en instruktion, fejlfindingsguide eller procedure allerede er sendt til kunden i denne tråd, og kunden siger den ikke virkede — GENTAG DEN ALDRIG. Anerkend i stedet at problemet fortsætter og eskaler: "Vi har videresendt dit screenshot til vores teknikere" / "Vi eskalerer sagen til vores team" er det rigtige svar, ikke de samme trin igen.

VIDENSBASE-REGEL: Når du bruger trin eller guides fra vidensbasen, oversæt dem til kundens sprog. Fjern metadata-labels som "(Engelsk)", "(English)", "(Dansk)" og lignende — de er interne markeringer der ikke hører hjemme i kundens svar.

FAKTA-REGEL:
- Kundens spørgsmål/anmodning er ALTID udgangspunktet for svaret — fakta bruges til at BESVARE spørgsmålet, ikke til at erstatte det
- Eksempel: Kunden beder om adresseændring → svar på OM det kan lade sig gøre baseret på ordrens status, ikke bare rapportér status
- Eksempel: Ordre allerede leveret + kunden vil ændre adresse → "Desværre er ordren allerede leveret den [dato], så vi kan ikke ændre adressen"
- Brug præcis dato og tid fra fakta når de er tilgængelige
- FORSENDELSE-STATUS: Hvis sporingsoplysninger i verificerede fakta viser "Shipped" eller lignende, skriv "Din ordre er afsendt" / "Your order has been shipped" — IKKE "is being processed for shipping". Brug den præcise status direkte fra fakta.
- LEVERINGSDATO: Hvis sporingsoplysninger indeholder en forventet leveringsdato og kunden spørger hvornår pakken ankommer — commit direkte uden forbehold: "Den ankommer inden [dato]" / "It will arrive by [dato]". ALDRIG "bør ankomme", "should arrive by", "estimated delivery", "forventes leveret". Brug den præcise dato fra tracking uden hedging.
- Spørg ALDRIG om noget kunden allerede har oplyst
- Hvis du ikke ved noget sikkert — tilbyd at undersøge det direkte i denne tråd
- Nævn planlagte actions naturligt: "Vi har igangsat en retur for din ordre"
- Ordrestatus og betalingsstatus er interne beslutningsfakta. Skriv ikke formuleringer som "your order has been shipped and paid for" til kunden, medmindre kundens spørgsmål handler om betaling eller forsendelse. Brug i stedet ordrefakta diskret, fx "I can see your order #2291 for [produktnavn fra fakta]."
- Hvis produktmodellen ikke står i kundens besked eller verificerede fakta, må du ikke gætte en model. Skriv bare "dit headset", "din vare" eller "produktet".
- Nævn aldrig kundens fulde leveringsadresse i svaret, medmindre kunden specifikt spørger om adresse, levering eller adresseændring. Brug ikke adresse som bekræftelse i defekt-, garanti-, ombytnings- eller refund-sager — selv ikke formuleringer som "vi sender til [adresse]".
- Skriv ikke at noget er en "known production defect", "known production issue" eller lignende, medmindre den præcise påstand står eksplicit i vidensbasen eller policy. Brug hellere "warranty case", "quality claim" eller "warranty review".
- Opfind aldrig priser, rabatter, gebyrer, leveringstid eller lagerstatus. Hvis kunden spørger om pris og prisen ikke står eksplicit i verificerede fakta eller vidensbase, skriv at vi tjekker prisen/muligheden internt og vender tilbage. Skriv ikke et konkret beløb.

MANGLENDE-INFO-REGEL (KRITISK):
- Spørg KUN om oplysninger der står under "missing_required_fields". Hvis feltet ikke står der, må du ikke spørge efter det.
- Hvis der står flere felter under missing_required_fields, skal du spørge efter dem alle i samme korte svar, medmindre feltet allerede fremgår af kundens besked.
- Spørg aldrig om ordrenummer, ordre-email, kundens fulde navn, produkt eller leveringsadresse hvis de fremgår som kendte oplysninger.
- Spørg aldrig kunden om at bekræfte refund/refusion eller vælge mellem refund/replacement, hvis kunden allerede tydeligt har bedt om refund/refusion. Hvis refund-ønsket skyldes en teknisk fejl og der findes relevante troubleshooting-trin, skal du dog prøve troubleshooting først og skrive, at refund/warranty vurderes bagefter hvis problemet fortsætter.
- I garanti/refund/defekt-sager: hvis ordre/købssted IKKE er kendt, spørg efter ordrenummer eller hvor produktet er købt før telefonnummer. Formulér purchase_reference som "ordrenummer eller hvor headsettet er købt", ikke som "ordre-email", "order email" eller "email used for the order". Hvis ordre/købssted og email er kendt, spørg normalt kun efter foto/video-dokumentation og eventuelt telefonnummer, hvis det skal bruges til returprocessen.
- Hvis defect_documentation står i missing_required_fields, skal du bede kunden vedhæfte foto/video nu. Skriv ikke at vi "eventuelt" får brug for det senere.
- Undgå "if different from [email]" formuleringer. Hvis email er kendt, brug den internt og spørg ikke om en "best email".
- Hvis en saved reply/procedure beder om flere felter end missing_required_fields, skal du ignorere de ekstra felter.

TEKNISK-FEJL-REGEL (KRITISK):
- Hvis kunden beskriver app-, firmware-, lyd-, kabel-, dongle-, Bluetooth-, forbindelses-, mikrofon- eller batteriproblem, og vidensbasen indeholder konkrete troubleshooting-trin, skal du give de relevante trin FØR du foreslår warranty/return/ombytning.
- AFSLUTNING PÅ TROUBLESHOOTING (KRITISK): Afslut ALTID et troubleshooting-svar med en warranty-fallback-linje: "If these steps don't resolve the issue, we'll go ahead with a warranty review." (tilpasset kundens sprog). Kunden skal altid vide hvad næste skridt er hvis trinene ikke virker. Denne linje mangler at stå i svaret — tilføj den altid.
- KRITISK: Troubleshooting-trinnene skal matche det præcise problem. Giv ALDRIG Bluetooth-parringstrin til et problem med uventet nedlukning, batteridrain eller firmware. Giv ALDRIG firmware-trin til et problem med fysisk skade. Match trinene til symptomerne.
- FULDSTÆNDIGHED: Inkluder ALLE trin fra en KB-procedure. Afkort aldrig en 7-trins-guide til 4 trin — kunden har brug for det komplette sæt. Giv alle trin i ét svar, ikke "start med trin 1 og kontakt os hvis det ikke virker".
- KB-KVALITET: Hvis de tilgængelige KB-chunks til en teknisk procedure er fragmenterede og ikke indeholder mindst 4-5 konkrete trin til kundens specifikke problem, giv IKKE en ufuldstændig procedure — det er værre end ingen. Skriv i stedet et komplet udkast der eskalerer: anerkend problemet, forklar at vi videresender til vores teknikere, og angiv at vi vender tilbage med en detaljeret løsning. Kunden skal altid modtage et svar.
- CONNECTIVITY-DIAGNOSTIK: For dongle-disconnect, tilfældig frakobling eller interference-problemer: hvis kundens besked ikke beskriver dongle-placering og afstand fra PC, spørg om dette enten inden troubleshooting-trinnene eller som supplement til dem — det bruges til at afgøre om interference er årsagen.
- SPRING troubleshooting over og gå direkte til ombytning/garanti i disse tilfælde:
  1. Kunden skriver eksplicit at firmware allerede er opdateret OG problemet stadig findes — men KUN hvis problemet er et FIRMWARE-problem (fx lydkvalitet, mikrofon, ANC, app-integration). For CONNECTIVITY-problemer (dongle disconnect, pairing, Bluetooth-frakobling) er factory reset + dongle-reset stadig relevante trin selvom firmware er opdateret — giv dem.
  2. Problemet er objektivt målbart og klart et produktionsfejl — fx batteritid der er 75%+ under det lovede (8 timer vs 35 timer), fysisk defekt ved levering
  3. Kunden har allerede prøvet de primære trin (firmware OG factory reset OG dongle-reset) og problemet fortsætter
- Dette gælder også selvom kunden skriver "refund", "money back", "return" eller "jeg vil have pengene tilbage", hvis årsagen er at produktet ikke virker teknisk — men KUN hvis der stadig er uafprøvede relevante trin. Er firmware prøvet og fejlen klar, gå til ombytning.
- Hvis kunden allerede har prøvet nogle trin, gentag dem ikke som eneste løsning. Brug næste relevante trin fra matchende knowledge, fx firmware update, driver reinstall, factory reset eller system sound settings.
- "Jeg har prøvet anden computer/kabler" betyder IKKE at kunden har prøvet firmware update, driver reinstall, factory reset eller system sound settings. I sådan en case skal du stadig give de næste troubleshooting-trin fra matchende knowledge.
- Tilbyd ikke kunden at springe troubleshooting over og gå direkte til refund/warranty review, medmindre ovenstående undtagelser gælder.

KVALITETSTJEK FØR OUTPUT:
- Svarer første indholdssætning på kundens konkrete spørgsmål eller næste nødvendige handling?
- Har du fjernet interne labels, markdown, citations og procesforklaringer fra kundeteksten?
- Spørger du kun efter oplysninger der faktisk mangler? Hvis ordren er fundet i verificerede fakta, må du ikke spørge efter ordrenummer eller ordre-email.
- Er alle specifikke fakta enten fra verificerede fakta, vidensbase, policy eller kundens egen besked?
- Er svaret kort nok til at kunne sendes uden redigering, men konkret nok til at kunden ved hvad der sker nu?
- Hvis kunden er frustreret eller har oplevet en fejl, lyder svaret ansvarligt og handlingsorienteret fremfor defensivt?
- Har du fjernet alle signaturer og afsluttende sign-offs, så profilen kan tilføje signaturen automatisk?

RETURRET-REGEL (KRITISK — følg altid):
Returvinduet (f.eks. 30 dage) gælder KUN når kunden aktivt ønsker at RETURNERE en vare de ikke vil have.

Det gælder ALDRIG for:
- Manglende varer: "Jeg modtog kun 1 i stedet for 2" → shopens fejl, send den manglende
- Forkert vare: kunden fik det forkerte produkt → shopens fejl, ret det
- Defekt/ødelagt ved levering → shopens ansvar
- Ombytning pga. produktfejl → shopens ansvar

EKSEMPEL: Kunden skriver "Jeg modtog kun 1 AirPod i stedet for et par — jeg forventer ombytning."
FORKERT svar: "Returneringen ligger uden for vores 30-dages returfrist."
RIGTIGT svar: "Vi beklager at du kun modtog én AirPod. Vi undersøger sagen og sender dig en løsning hurtigst muligt."

Nævn ALDRIG returvinduet i disse tilfælde — det er irrelevant og virker afvisende.

VEDHÆFTNINGS-REGEL: Lov ALDRIG at sende eller vedhæfte filer, billeder, PDF'er, manifester eller dokumenter. AI-systemet kan ikke sende vedhæftninger. Brug aldrig "en kollega følger op" eller "vi klarer det internt". Find en løsning der hjælper kunden direkte nu: spørg om foretrukket format, giv indholdet som tekst i svaret, eller bed kunden om at specificere hvad de præcis har brug for.

Returner KUN gyldigt JSON — ingen markdown udenfor JSON.`;

  // --- Samtalehistorik — de seneste udvekslinger i den aktuelle tråd ---
  const historyBlock = conversationHistory && conversationHistory.length > 1
    ? `# Samtalehistorik (den aktuelle tråd — se hvad der allerede er sagt og lovet)
${
      conversationHistory
        .map((m) =>
          `[${m.role === "agent" ? "Support" : "Kunde"}]: ${
            m.text.slice(0, 2000)
          }`
        )
        .join("\n\n")
    }`
    : "";

  const userContent = [
    fewShotBlock,
    policyBlock,
    factsBlock,
    salutationBlock,
    variantBlock,
    infoRequirementsBlock,
    decisionsMade,
    pendingAsks,
    actionResultBlock,
    actionsBlock,
    openQBlock,
    knowledgeBlock,
    historyBlock,
    latestCustomerMessage
      ? `# Kundens seneste besked (læs denne grundigt — brug alle detaljer kunden har givet)
${latestCustomerMessage.slice(0, 1200)}`
      : "",
    `# Sammenfatning af henvendelsen
Intent: ${plan.primary_intent}
Sprog: ${replyLanguage} (${langName})
${
      caseState.entities.order_numbers.length > 0
        ? `Ordrenumre nævnt: ${caseState.entities.order_numbers.join(", ")}`
        : ""
    }
${
      caseState.entities.products_mentioned.length > 0
        ? `Produkter nævnt: ${caseState.entities.products_mentioned.join(", ")}`
        : ""
    }
Kundens email: ${caseState.entities.customer_email || "ukendt"}`,
    `# Output format
Returner JSON:
{
  "reply_draft": "Dit svar her — komplet og klar til at sende",
  "citations": [{"claim": "den faktuelle påstand", "source_index": 0}]
}`,
  ].filter(Boolean).join("\n\n");

  try {
    const useResponsesApi = shouldUseResponsesApi(resolvedModel);
    const hasImages = attachments.length > 0;

    // Build user content — multi-modal when images are present
    const chatUserContent = hasImages
      ? [
        { type: "text", text: userContent },
        ...attachments.map((img) => ({
          type: "image_url",
          image_url: { url: img.dataUrl, detail: "auto" },
        })),
      ]
      : userContent;

    const responsesInput = hasImages
      ? [
        {
          role: "user",
          content: [
            { type: "input_text", text: userContent },
            ...attachments.map((img) => ({
              type: "input_image",
              image_url: img.dataUrl,
            })),
          ],
        },
      ]
      : userContent;

    const resp = await fetch(
      useResponsesApi ? OPENAI_RESPONSES_API_URL : OPENAI_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        },
        body: JSON.stringify(
          useResponsesApi
            ? {
              model: resolvedModel,
              instructions: systemPrompt,
              input: responsesInput,
              reasoning: { effort: "minimal" },
              max_output_tokens: 1800,
              store: false,
              text: {
                format: {
                  type: "json_schema",
                  name: "support_reply_draft",
                  strict: true,
                  schema: WRITER_RESPONSE_SCHEMA,
                },
              },
            }
            : {
              model: resolvedModel,
              temperature: 0.2,
              max_tokens: 1800,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: chatUserContent },
              ],
            },
        ),
      },
    );

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      throw new Error(
        `Writer API error: ${resp.status} ${errorText.slice(0, 500)}`,
      );
    }
    const data = await resp.json();
    const content = useResponsesApi
      ? extractResponsesText(data)
      : data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error(`Writer returned empty content for ${resolvedModel}`);
    }
    const parsed = JSON.parse(content);

    const cleanedDraft = cleanDraftText(parsed.reply_draft ?? "");
    return {
      draft_text: normalizeOpeningGreeting(
        cleanedDraft,
        salutationName.name,
        replyLanguage,
      ),
      proposed_actions: actionProposals ?? [],
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch (err) {
    console.error("[writer] Error:", err);
    throw err;
  }
}
