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
  customerHistory?: string;
  nonImageAttachmentsMeta?: string;
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
  /^(?:best regards|kind regards|warm regards|all the best|regards|with warm regards|sincerely|yours sincerely|cheers|thanks|thank you|mvh|venlig hilsen|med venlig hilsen|de bedste hilsner|mange hilsner|hilsen|god dag|have a great day|ha en god dag|auf wiedersehen|bonne journée|fijne dag)[,.!]?$/i;

// Matches shop/team name signature lines like "AceZone Support", "The AceZone Team", "Support-teamet"
const SHOP_SIGNATURE_LINE_RE =
  /^(?:the\s+\w+\s+team|[A-Z][a-zA-Z]+ Support|[A-Z][a-zA-Z]+ Kundeservice|Support.?teamet|Customer Service Team|Kundeservice)$/i;

function stripGeneratedSignature(text: string): string {
  const lines = text.replace(/\s+$/u, "").split("\n");
  let end = lines.length - 1;
  // Skip trailing blank lines
  while (end >= 0 && !lines[end].trim()) end--;

  const min = Math.max(0, end - 6);
  for (let i = end; i >= min; i--) {
    const trimmed = lines[i].trim();
    if (SIGNOFF_LINE_RE.test(trimmed)) {
      return lines.slice(0, i).join("\n").replace(/\s+$/u, "");
    }
    // Also strip shop-name signature lines — keep scanning upward
    if (SHOP_SIGNATURE_LINE_RE.test(trimmed)) {
      continue; // keep looking for the signoff line above this
    }
  }

  return text.trim();
}

function cleanDraftText(text: string): string {
  return stripGeneratedSignature(text)
    .replace(/\s+[—–]\s+/g, ", ")
    // Strip any instruction to contact via email — customer is already in the right thread.
    .replace(
      /[^.!?\n]*(?:contact|reach|email)\s+us[^.!?\n]*\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:kontakte?\s+os|skriv\s+til\s+os|send\s+(?:en\s+)?(?:mail|e-?mail)\s+til\s+os)[^.!?\n]*\S+@\S+[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:via|på|til)\s+(?:e-?mail\s+)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}[^.!?\n]*/gi,
      "",
    )
    .replace(
      /[^.!?\n]*(?:\bat\b|\bto\b)\s+[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}[^.!?\n]*/gi,
      "",
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
    // Telefonnummer er IKKE påkrævet — fjernet da det skaber forvirring og ikke bruges i workflow
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

async function runPostActionRefundWriter(
  amountDisplay: string,
  orderName: string,
  language: string,
  greeting: string,
  closing: string,
): Promise<string> {
  const amountClause = amountDisplay && !/^0[,.]?0*\s/.test(amountDisplay)
    ? `Amount refunded: ${amountDisplay}`
    : "";

  const systemPrompt =
    `You write 2-sentence post-action support confirmations. Output ONLY the 2 sentences — no greeting, no closing, no signature, no extra words.`;

  const userPrompt =
    `A refund has been executed in Shopify. Write exactly 2 sentences in language "${language}":
1. State the refund is done (past tense). Include "${orderName}"${amountClause ? ` and "${amountDisplay}"` : ""}.
2. Say the amount will appear back on their account within 3-5 business days (use natural phrasing for "${language}").

Output: the 2 sentences only.`;

  try {
    const resp = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!resp.ok) throw new Error(`post-action writer status ${resp.status}`);
    const data = await resp.json();
    const body = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!body) throw new Error("empty post-action body");
    return `${greeting}\n\n${body}\n\n${closing}`;
  } catch (err) {
    console.warn("[writer] post-action fallback:", err);
    return "";
  }
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
    customerHistory,
    nonImageAttachmentsMeta,
  }: WriterInput,
): Promise<WriterResult> {
  const resolvedModel = model ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-5-mini";
  const shopName = (shop as { name?: string }).name ?? "butikken";
  const persona =
    (shop as { persona_instructions?: string; instructions?: string })
      .persona_instructions ??
      (shop as { instructions?: string }).instructions ??
      "";

  const recentCustomerText = [
    ...conversationHistory.filter((m) => m.role === "customer").slice(-3).map((m) => m.text),
    latestCustomerMessage ?? "",
  ].filter(Boolean).join(" ");
  const replyLanguage = resolveReplyLanguage(recentCustomerText, "en");
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
            const contextBlock = ex.conversation_context
              ? `Tidligere i samtalen:\n${ex.conversation_context.slice(0, 400)}\n`
              : "";
            return `[Eksempel ${i + 1}${label}]
${contextBlock}Kunde: "${ex.customer_msg.slice(0, 350)}"
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
  // If the action returned amount=0 (e.g. cancellation flow that triggers a Shopify refund internally),
  // try to recover the real order total from facts so the confirmation can cite the correct amount.
  const actionAmountIsZero = !actionAmountDisplay ||
    /^0[,.]?0*\s*/.test(actionAmountDisplay.trim());
  const fallbackAmountFromFacts = actionAmountIsZero
    ? (() => {
        const orderTotal = facts.facts.find((f) =>
          /total|price|amount|beløb|pris/i.test(f.label)
        )?.value ?? "";
        return orderTotal;
      })()
    : "";
  const resolvedAmountDisplay = actionAmountIsZero && fallbackAmountFromFacts
    ? fallbackAmountFromFacts
    : actionAmountDisplay;

  const actionOutcome = String(actionResult?.outcome || "executed");
  const actionResultBlock = actionResult
    ? actionOutcome === "declined"
      ? `# POST-ACTION RESULT MODE — AFVIST (primær opgave for dette svar)
En medarbejder har gennemgået kundens anmodning og valgt IKKE at udføre handlingen. Skriv et kort, venligt svar til kunden der forklarer situationen.

- action_type: ${String(actionResult.action_type || "")}
- order_name: ${String(actionResult.order_name || actionResult.order_number || "")}
- detail: ${String(actionResult.detail || "")}

Regler for afvist-svaret:
- Svar på samme sprog som kunden.
- Hold svaret kort: 2-3 sætninger max.
- Ingen signatur, ingen "kontakt os hvis..."-standardlinje, ingen support-email.
- Ingen "tak for din besked" eller generisk varm indledning efter hilsenen — gå direkte til svaret.
- Hvis action_type er "cancel_order": forklar at ordren allerede er afsendt og derfor ikke kan annulleres. Henvis kunden til at sende den retur når den ankommer.
- Hvis action_type er "update_shipping_address": forklar at ordren allerede er afsendt og adressen ikke kan ændres.
- Brug ikke "desværre" mere end én gang. Vær direkte og hjælpsom.`
      : `# POST-ACTION RESULT MODE (primær opgave for dette svar)
Kundens sag er allerede godkendt og handlingen er allerede udført i Shopify. Svaret er derfor en kort bekræftelse til kunden, ikke et forslag, en vurdering eller en ny supportproces.

- action_type: ${String(actionResult.action_type || "")}
- outcome: ${actionOutcome}
- order_name: ${String(actionResult.order_name || actionResult.order_number || "")}
- amount_display: ${resolvedAmountDisplay || "(ukendt — brug ordretotal fra Verificerede fakta hvis tilgængelig)"}
- currency: ${String(actionResult.currency || "")}
- detail: ${String(actionResult.detail || "")}

Regler for post-action-svaret:
- Svar på samme sprog som kunden.
- Brug PRÆTERITUM (datid/perfektum) — handlingen ER UDFØRT. Aldrig "vil blive", "kan", "behandles" eller "igangsat".
- Bekræft kun den udførte handling og de relevante fakta ovenfor. Hold svaret kort: 2-3 sætninger max.
- Ingen signatur, ingen "kontakt os hvis..."-standardlinje, ingen support-email.
- Ingen "tak for din besked" eller generisk varm indledning efter hilsenen — gå direkte til resultatet.
- FORBUDTE ord og formuleringer (brug ingen af disse): "vi har tilbudt", "tilbudt en refundering", "vi kan refundere", "vi har igangsat", "vil blive refunderet", "vil blive tilbageført", "vi behandler", "hurtigst muligt", "din anmodning er blevet behandlet", "sagen sendes videre", "venter på godkendelse", "nemt annullere og sikre".
- Hvis action_type indeholder "refund" eller "cancel": (1) Skriv at beløbet (amount_display) ER refunderet og går tilbage til den oprindelige betalingsmetode. (2) Skriv at det typisk tager 3-5 hverdage at se beløbet på kontoen — dette er standard bankbehandlingstid og må altid inkluderes i refund-bekræftelser. (3) Hvis amount_display er 0 eller tom, find ordretotalen fra Verificerede fakta og brug den i stedet.
- Eksempel på korrekt refund-bekræftelse (dansk): "Beløbet på [X] er blevet refunderet for din ordre [#N]. Du burde se det tilbage på din konto inden for 3-5 hverdage."
- Eksempel på korrekt refund-bekræftelse (engelsk): "A refund of [X] has been processed for your order [#N]. You should see it back in your account within 3-5 business days."`
    : "";

  // --- Viden fra vidensbase ---
  const knowledgeBlock = chunksForPrompt.length > 0
    ? `# Relevant viden fra vidensbasen med kildepolitik
Kildepolitik:
- policy: autoritativ regel fra webshoppen/Shopify policy — følg altid.
- procedure: følg processen præcist, men spørg kun om felter fra missing_required_fields.
- fact: autoritativt produktfakta eller direkte svar — behandl som verificeret sandhed og brug direkte i svaret. Opfind ikke tal, specs eller kompatibilitet der ikke fremgår eksplicit.
- saved_reply: brug som tone/struktur eller genvej, men den må ikke overrule verificerede fakta, policy eller missing_required_fields.
- tone_example/background: brug kun som kontekst, ikke som sandhed eller proces.
- ignore: må ikke bruges i kundesvaret.
- risk_flags=strong_claim: formulér forsigtigt, medmindre samme claim støttes af policy eller fact.
- risk_flags=asks_for_extra_fields: kopier aldrig de ekstra feltkrav; brug kun missing_required_fields.

` +
      chunksForPrompt
        .filter((c) => c.usable_as !== "ignore")
        .map(
          (c, i) =>
            `[kilde ${i}] ${c.source_label}
usable_as: ${c.usable_as}
risk_flags: ${c.risk_flags.length ? c.risk_flags.join(", ") : "none"}
${c.content.slice(0, (c.usable_as === "procedure" || c.usable_as === "fact") ? 2500 : 1500)}`,
        )
        .join("\n\n")
    : "";

  // --- Focused post-action draft for refund/cancel — uses a minimal LLM call ---
  if (actionResult && /refund|cancel/i.test(String(actionResult.action_type || ""))) {
    const orderName = String(
      actionResult.order_name || actionResult.order_number || "",
    );
    const closingByLang: Record<string, string> = {
      da: "God dag!",
      sv: "Ha en bra dag!",
      no: "Ha en fin dag!",
      de: "Auf Wiedersehen!",
      nl: "Fijne dag!",
      fr: "Bonne journée !",
      en: "Have a great day!",
    };
    const closing = closingByLang[replyLanguage] ?? "Have a great day!";
    const greetingLine = salutationName.name
      ? `${greetingPrefix(replyLanguage)} ${salutationName.name},`
      : `${greetingPrefix(replyLanguage)},`;
    const postActionDraft = await runPostActionRefundWriter(
      resolvedAmountDisplay,
      orderName,
      replyLanguage,
      greetingLine,
      closing,
    );
    if (postActionDraft) {
      return {
        draft_text: postActionDraft,
        proposed_actions: actionProposals ?? [],
        citations: [],
      };
    }
  }

  const isFollowUp = caseState.decisions_made.length > 0 ||
    caseState.pending_asks.length > 0;
  const conversationTurn = conversationHistory ? conversationHistory.length : 0;
  const isLateInConversation = conversationTurn >= 4;
  const isConfirmationReply = caseState.decisions_made.length > 0 &&
    caseState.open_questions.length === 0 &&
    caseState.pending_asks.length === 0;

  const systemPrompt = `Du er en supportmedarbejder for ${shopName}.
${
    persona
      ? `\n${persona}\n`
      : `\nVær kortfattet, direkte og hjælpsom. 2-4 sætninger er nok til simple sager. Gå straks til sagen.\n`
  }
SPROG (absolut): Svar KUN på ${replyLanguage} (${langName}). Bland aldrig sprog.
${languageCorrectionInstruction ? `SPROGKORREKTION: ${languageCorrectionInstruction}` : ""}

ABSOLUTTE FORBUD:
- Du er et menneske. Aldrig "Som AI kan jeg...".
- Skriv ALDRIG signatur, navn, sign-off eller email-adresser i svaret — tilføjes automatisk.
- Brug KUN fakta fra "Verificerede fakta". Opfind aldrig priser, datoer, ordrenumre eller policies.
- ALDRIG falsk bekræftelse: skriv ALDRIG at en handling er udført medmindre actionResult bekræfter det eksplicit. Planlagte actions er forslag der venter på menneskelig godkendelse.
- ALDRIG "sender videre til teamet", "videreformidler", "kontakt kundesupport" — tag handlingen nu eller forklar præcist hvad der mangler.
- Spørg ALDRIG om telefonnummer.
- URLs som plain text — aldrig markdown [tekst](url).
- Kald ALDRIG kundens problem for "produktionsfejl" eller "fabriksfejl" — brug kundens egne ord.
${
    actionResult
      ? `
POST-ACTION (primær opgave — al anden kontekst er sekundær):
Handlingen er allerede udført i Shopify. Skriv KUN 2-3 sætninger.
- Brug PRÆTERITUM — aldrig "vil blive", "kan", "behandles", "igangsat".
- For refund/cancel: (1) beløbet ER refunderet med amount_display + ordrenavn, (2) 3-5 hverdage på kontoen.
- Ingen "tak for din besked", ingen "kontakt os hvis...", ingen genforklaring.
- FORBUDT: "vi har tilbudt", "vil blive refunderet", "hurtigst muligt", "sagen sendes videre".`
      : ""
  }

FAKTA OG VIDENSBASE:
- Besvar altid kundens konkrete spørgsmål med præcise fakta — rapportér ikke blot status.
- Følg KB-procedurer FULDT UD — aldrig forkortet. Giv ALLE trin.
- Brug kun indhold fra en source hvis dens emne matcher kundens specifikke problem.
- TEKNISK TROUBLESHOOTING: Giv specifikke trin FØR du nævner ombytning/garanti. Afslut altid med: "Løser trinene ikke problemet, hjælper vi selvfølgelig videre med en garantisag." UNDTAGELSE: kunden skriver eksplicit at de HAR prøvet alle trin — spring da direkte til næste skridt.
- Bland ALDRIG trin eller specs på tværs af produktmodeller.
- RETURNERING: Returvinduet gælder kun frivillig returnering. Defekter og shop-fejl er shopens ansvar uanset frist.
- FAKTURA-REGEL: Når action er "resend_confirmation_or_invoice" — skriv som om fakturaen er vedhæftet nu (datid), hold svaret til 1-2 sætninger + lukning.

ÅBNING (absolut):
- ALDRIG: "Tak for din henvendelse", "Tak fordi du kontakter os", "Vi er kede af at høre", "I'm sorry to hear", "Thank you for reaching out".
- Start direkte med svaret. Undtagelse: tydelig frustration → ét kort empatisk ord er OK.

TONE OG SAMTALE-FASE:
- "thanks"/"update": KUN 1-2 sætningers anerkendelse. Ingen spørgsmål, ingen handlingsforslag.
- Første svar: komplet forklaring med alle relevante trin.
- Opfølgning (decisions_made ikke tom): kortere — gå direkte til det nye, gentag ikke hvad der er aftalt.
- Bekræftelse (decisions_made ikke tom, ingen åbne spørgsmål): max 2-3 sætninger.
- Sent i samtalen (4+ beskeder): kort og direkte som en kollega der kender sagen.
- Gentaget problem (⚠ i kundehistorik): anerkend det, spring standard-forklaringer over.

AFSLUTNING:
- Afventer svar/billeder: "Jeg ser frem til at høre fra dig."
- Sag løst: "God dag!"
- Frustration/forsinkelse: "Undskyld for ulejligheden og tak for din tålmodighed."
- Aldrig: "er du velkommen til at kontakte os igen".

INTENT:
- "thanks"/"update": KUN 1-2 sætningers anerkendelse — ingen spørgsmål, ingen troubleshooting.
- "other" uden åbne spørgsmål: anerkend og afslut kortfattet.

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

  const customerHistoryBlock = customerHistory
    ? `# Kundehistorik (tidligere kontakter fra samme kunde)
${customerHistory}`
    : "";

  const userContent = [
    fewShotBlock,
    // Conversation history placed early so the model processes prior context
    // before KB content — critical for follow-up messages and multi-turn threads.
    historyBlock,
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
    customerHistoryBlock,
    latestCustomerMessage
      ? `# Kundens seneste besked (læs denne grundigt — brug alle detaljer kunden har givet)
${latestCustomerMessage.slice(0, 1200)}${
          nonImageAttachmentsMeta
            ? `\n\n[Kunden har vedhæftet: ${nonImageAttachmentsMeta}. Anerkend at du kan se det i dit svar, men analyser ikke indholdet da du ikke kan læse det — behandl det som dokumentation kunden har sendt.]`
            : ""
        }`
      : "",
    `# Sammenfatning af henvendelsen
Intent: ${plan.primary_intent}
Sprog: ${replyLanguage} (${langName})
Samtale-fase: ${
      isConfirmationReply
        ? "BEKRÆFTELSE — max 2-3 sætninger, ingen genforklaring"
        : isLateInConversation
        ? `SENT I SAMTALEN (${conversationTurn} beskeder) — kort og direkte, kunden kender konteksten`
        : isFollowUp
        ? `OPFØLGNING (turn ${conversationTurn}) — kortere end første svar, undgå gentagelser`
        : "FØRSTE SVAR — giv komplet forklaring"
    }
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
