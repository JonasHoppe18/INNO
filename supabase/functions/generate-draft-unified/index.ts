// supabase/functions/generate-draft-unified/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildAutomationGuidance,
  fetchAutomation,
  fetchOwnerProfile,
  fetchPersona,
  fetchPolicies,
} from "../_shared/agent-context.ts";
import { AutomationAction, executeAutomationActions } from "../_shared/automation-actions.ts";
import { classifyEmail } from "../_shared/classify-email.ts";
import { PERSONA_REPLY_JSON_SCHEMA } from "../_shared/openai-schema.ts";
import { buildOrderSummary, resolveOrderContext } from "../_shared/shopify.ts";
import { buildMailPrompt } from "../_shared/prompt.ts";
import { formatEmailBody } from "../_shared/email.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – generate-draft-unified kan ikke kalde Supabase.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – generate-draft-unified kan ikke læse tabeller.");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY mangler – AI udkast vil kun bruge fallback.");
if (!Deno.env.get("OPENAI_MODEL")) console.warn("OPENAI_MODEL mangler – bruger default gpt-4o-mini.");
if (!Deno.env.get("OPENAI_EMBEDDING_MODEL"))
  console.warn("OPENAI_EMBEDDING_MODEL mangler – bruger default text-embedding-3-small.");
if (!ENCRYPTION_KEY)
  console.warn("ENCRYPTION_KEY mangler – Shopify opslag/dekryptering kan fejle.");

// Service-role klient bruges til at læse/skrive på tværs af tenants.
const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) console.log(...args);
};

type EmailData = {
  messageId?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  fromEmail?: string;
  body?: string;
  headers?: Array<{ name: string; value: string }>;
};

type AgentContext = {
  profile: Awaited<ReturnType<typeof fetchOwnerProfile>>;
  persona: Awaited<ReturnType<typeof fetchPersona>>;
  automation: Awaited<ReturnType<typeof fetchAutomation>>;
  policies: Awaited<ReturnType<typeof fetchPolicies>>;
  orderSummary: string;
  matchedSubjectNumber: string | null;
  orders: any[];
};

type OpenAIResult = {
  reply: string | null;
  actions: AutomationAction[];
};

const PII_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PII_PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/g;

const stripHtmlSimple = (html: string) =>
  String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const normalizeLine = (value: string) => String(value || "").replace(/\s+/g, " ").trim();

const maskPii = (value: string) =>
  normalizeLine(value).replace(PII_EMAIL_REGEX, "[email]").replace(PII_PHONE_REGEX, "[phone]");

const splitLines = (value: string) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const wordCount = (value: string) =>
  normalizeLine(value)
    .split(" ")
    .filter(Boolean).length;

const detectLanguage = (samples: string[]) => {
  const danishHints = ["hej", "tak", "venlig", "hilsen", "mvh", "ordre", "pakke"];
  const englishHints = ["hi", "hello", "thanks", "regards", "order", "shipping"];
  let da = 0;
  let en = 0;
  samples.forEach((text) => {
    const lower = text.toLowerCase();
    danishHints.forEach((word) => {
      if (lower.includes(word)) da += 1;
    });
    englishHints.forEach((word) => {
      if (lower.includes(word)) en += 1;
    });
  });
  if (da === 0 && en === 0) return null;
  return da >= en ? "Danish" : "English";
};

const extractGreeting = (text: string) => {
  const firstLine = splitLines(text)[0] || "";
  const lower = firstLine.toLowerCase();
  if (lower.startsWith("hej")) return "Hej";
  if (lower.startsWith("hi")) return "Hi";
  if (lower.startsWith("hello")) return "Hello";
  if (lower.startsWith("dear")) return "Dear";
  return null;
};

const extractSignoff = (text: string) => {
  const lines = splitLines(text);
  const last = lines[lines.length - 1]?.toLowerCase() || "";
  if (last.includes("mvh")) return "Mvh";
  if (last.includes("venlig hilsen")) return "Venlig hilsen";
  if (last.includes("best regards")) return "Best regards";
  if (last.includes("kind regards")) return "Kind regards";
  if (last.includes("regards")) return "Regards";
  if (last.includes("cheers")) return "Cheers";
  return null;
};

const extractPhrasesToAvoid = (text: string) => {
  const phrases = [
    "hope this email finds you well",
    "tak for din henvendelse",
    "vi beklager ulejligheden",
  ];
  const lower = text.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase));
};

const mergeBullets = (base: string[], extra: string[], max = 8) => {
  const seen = new Set<string>();
  const output: string[] = [];
  [...base, ...extra].forEach((item) => {
    const cleaned = item.replace(/^[-•]\s*/, "").trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    output.push(`- ${cleaned}`);
  });
  return output.slice(0, max);
};

async function fetchLearningProfile(
  mailboxId: string | null,
  userId: string | null,
): Promise<{ enabled: boolean; styleRules: string[] }> {
  if (!supabase || !mailboxId || !userId) return { enabled: false, styleRules: [] };
  const { data, error } = await supabase
    .from("mail_learning_profiles")
    .select("enabled, style_rules")
    .eq("mailbox_id", mailboxId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("generate-draft-unified: learning profile fetch failed", error.message);
    return { enabled: false, styleRules: [] };
  }
  const styleRules = String(data?.style_rules || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return { enabled: data?.enabled !== false, styleRules };
}

async function fetchMailboxHistory(mailboxId: string | null, userId: string | null) {
  if (!supabase || !mailboxId || !userId) return [];
  const { data, error } = await supabase
    .from("mail_messages")
    .select("body_text, body_html, from_me, sent_at, received_at, created_at")
    .eq("mailbox_id", mailboxId)
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.warn("generate-draft-unified: mailbox history fetch failed", error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

function buildStyleHeuristics(history: Array<any>): string[] {
  if (!history.length) return [];
  const sent = history.filter((msg) => msg?.from_me && msg?.sent_at);
  const samples = (sent.length ? sent : history)
    .map((msg) => msg?.body_text || stripHtmlSimple(msg?.body_html || ""))
    .map(maskPii)
    .filter(Boolean);
  if (!samples.length) return [];

  const avgWords =
    samples.reduce((sum, text) => sum + wordCount(text), 0) / samples.length;

  const greetings = samples.map(extractGreeting).filter(Boolean) as string[];
  const signoffs = samples.map(extractSignoff).filter(Boolean) as string[];
  const avoidPhrases = samples.flatMap(extractPhrasesToAvoid);

  const topGreeting = greetings.sort(
    (a, b) => greetings.filter((g) => g === b).length - greetings.filter((g) => g === a).length
  )[0];
  const topSignoff = signoffs.sort(
    (a, b) => signoffs.filter((g) => g === b).length - signoffs.filter((g) => g === a).length
  )[0];

  const language = detectLanguage(samples);

  const bullets: string[] = [];
  if (Number.isFinite(avgWords)) {
    const rounded = Math.round(avgWords / 5) * 5;
    bullets.push(`Keep replies around ${rounded} words on average.`);
  }
  if (topGreeting) bullets.push(`Typical greeting: "${topGreeting}".`);
  if (topSignoff) bullets.push(`Typical sign-off: "${topSignoff}".`);
  if (language) bullets.push(`Preferred language: ${language}.`);
  if (avoidPhrases.length) bullets.push("Avoid filler phrases (e.g., “hope this email finds you well”).");

  return bullets;
}

// Find owner_user_id for shop så vi kan hente persona/policies/automation.
async function resolveShopOwnerId(shopId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shops")
    .select("owner_user_id")
    .eq("id", shopId)
    .maybeSingle();
  if (error) {
    console.warn("generate-draft-unified: failed to resolve shop owner", error.message);
  }
  return data?.owner_user_id ?? null;
}

// Laver embedding af mailtekst for at slå relevante produkter op via vector search.
async function embedText(input: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || `OpenAI embedding error ${res.status}`);
  }
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("OpenAI embedding missing");
  return vector;
}

// Hent produktkontekst så svaret kan blive mere præcist.
async function fetchProductContext(
  supabaseClient: ReturnType<typeof createClient> | null,
  userId: string | null,
  text: string,
) {
  if (!supabaseClient || !userId || !text?.trim()) return "";
  try {
    const embedding = await embedText(text.slice(0, 4000));
    const { data, error } = await supabaseClient.rpc("match_products", {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 5,
      filter_shop_id: userId,
    });
    if (error || !Array.isArray(data) || !data.length) return "";
    return data
      .map((item: any) => {
        const price = item?.price ? `Price: ${item.price}.` : "";
        return `Product: ${item?.title ?? "Unknown"}. ${price} Details: ${
          item?.description ?? ""
        }`;
      })
      .join("\n");
  } catch (err) {
    console.warn("generate-draft-unified: product context failed", err);
    return "";
  }
}

// Saml persona, automation flags, policies og ordre-kontekst for shoppen.
async function getAgentContext(
  shopId: string,
  email?: string,
  subject?: string,
): Promise<AgentContext> {
  const ownerUserId = await resolveShopOwnerId(shopId);
  const profile = await fetchOwnerProfile(supabase, ownerUserId);
  const persona = await fetchPersona(supabase, ownerUserId);
  const automation = await fetchAutomation(supabase, ownerUserId);
  const policies = await fetchPolicies(supabase, ownerUserId);
  const { orders, matchedSubjectNumber } = await resolveOrderContext({
    supabase,
    userId: ownerUserId,
    email,
    subject,
    tokenSecret: ENCRYPTION_KEY,
    apiVersion: SHOPIFY_API_VERSION,
  });
  const orderSummary = buildOrderSummary(orders);

  return {
    profile,
    persona,
    automation,
    policies,
    orderSummary,
    matchedSubjectNumber,
    orders,
  };
}

function buildFallbackSignature(firstName: string | null | undefined): string {
  const safeName = String(firstName || "").trim();
  if (safeName) {
    return `Best regards,\n${safeName}`;
  }
  return "Best regards,\nSona Team";
}

function stripTrailingSignoff(text: string): string {
  const closings = [
    "venlig hilsen",
    "med venlig hilsen",
    "mvh",
    "best regards",
    "kind regards",
    "regards",
    "sincerely",
    "cheers",
  ];
  const lines = text.split("\n");
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i -= 1;
  if (i < 0) return text;
  const last = lines[i].trim().toLowerCase();
  if (closings.includes(last)) {
    lines.splice(i, 1);
    while (lines.length && !lines[lines.length - 1].trim()) {
      lines.pop();
    }
    return lines.join("\n");
  }
  return text;
}

// Brug JSON schema så vi altid får reply + automation actions.
async function callOpenAI(prompt: string, system?: string): Promise<OpenAIResult> {
  if (!OPENAI_API_KEY) return { reply: null, actions: [] };
  const messages: any[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body = {
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: PERSONA_REPLY_JSON_SCHEMA,
    },
    max_tokens: 800,
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { reply: null, actions: [] };
  }
  try {
    const parsed = JSON.parse(content);
    const reply = typeof parsed?.reply === "string" ? parsed.reply : null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.filter((action: any) => typeof action?.type === "string")
      : [];
    return { reply, actions };
  } catch (_err) {
    return { reply: null, actions: [] };
  }
}

// Gmail raw MIME kræver base64url.
function toBase64Url(input: string): string {
  const b64 = btoa(unescape(encodeURIComponent(input)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Opret Gmail draft med HTML body og tråd-reference.
async function createGmailDraft(
  accessToken: string,
  emailData: EmailData,
  htmlBody: string,
) {
  const subject = emailData.subject ? `Re: ${emailData.subject}` : "Re:";
  const to = emailData.fromEmail || emailData.from || "";
  const rawLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ];
  if (emailData.messageId) {
    rawLines.push(`In-Reply-To: ${emailData.messageId}`);
    rawLines.push(`References: ${emailData.messageId}`);
  }
  rawLines.push("Content-Type: text/html; charset=utf-8");
  rawLines.push("");
  rawLines.push(htmlBody);

  const payload: Record<string, unknown> = {
    message: {
      raw: toBase64Url(rawLines.join("\r\n")),
    },
  };
  if (emailData.threadId) {
    (payload.message as Record<string, unknown>).threadId = emailData.threadId;
  }

  const res = await fetch(`${GMAIL_BASE}/drafts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail draft failed: ${text || res.status}`);
  }
  return text ? JSON.parse(text) : null;
}

// Opret Outlook draft med HTML body.
async function createOutlookDraft(
  accessToken: string,
  emailData: EmailData,
  htmlBody: string,
) {
  const subject = emailData.subject ? `Re: ${emailData.subject}` : "Re:";
  const to = emailData.fromEmail || emailData.from || "";
  const payload = {
    subject,
    body: {
      contentType: "HTML",
      content: htmlBody,
    },
    toRecipients: to
      ? [
          {
            emailAddress: {
              address: to,
            },
          },
        ]
      : [],
    isDraft: true,
  };

  const res = await fetch(`${GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Outlook draft failed: ${text || res.status}`);
  }
  return text ? JSON.parse(text) : null;
}

async function resolveInternalThread(
  userId: string | null,
  provider: string,
  emailData: EmailData,
) {
  if (!supabase || !userId) return { threadId: null, mailboxId: null };
  if (provider === "smtp" && emailData.threadId) {
    const { data } = await supabase
      .from("mail_threads")
      .select("id, mailbox_id")
      .eq("user_id", userId)
      .eq("id", emailData.threadId)
      .maybeSingle();
    if (data?.id) return { threadId: data.id, mailboxId: data.mailbox_id ?? null };
  }
  if (emailData.threadId) {
    const { data } = await supabase
      .from("mail_threads")
      .select("id, mailbox_id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("provider_thread_id", emailData.threadId)
      .maybeSingle();
    if (data?.id) return { threadId: data.id, mailboxId: data.mailbox_id ?? null };
  }
  if (emailData.messageId) {
    const { data } = await supabase
      .from("mail_messages")
      .select("thread_id, mailbox_id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("provider_message_id", emailData.messageId)
      .maybeSingle();
    if (data?.thread_id) return { threadId: data.thread_id, mailboxId: data.mailbox_id ?? null };
  }
  return { threadId: null, mailboxId: null };
}

async function createInternalDraft(options: {
  userId: string | null;
  mailboxId: string | null;
  threadId: string | null;
  provider: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}) {
  if (!supabase || !options.userId || !options.threadId || !options.provider) return null;

  // Keep a single active draft per thread, so newer customer emails replace stale drafts.
  const { error: cleanupError } = await supabase
    .from("mail_messages")
    .delete()
    .eq("user_id", options.userId)
    .eq("thread_id", options.threadId)
    .eq("is_draft", true)
    .eq("from_me", true);
  if (cleanupError) {
    throw new Error(`Internal draft cleanup failed: ${cleanupError.message}`);
  }

  const payload: Record<string, unknown> = {
    user_id: options.userId,
    mailbox_id: options.mailboxId,
    thread_id: options.threadId,
    provider: options.provider,
    provider_message_id: `draft-${options.threadId}-${Date.now()}`,
    subject: options.subject,
    snippet: options.textBody.slice(0, 160),
    body_text: options.textBody,
    body_html: options.htmlBody,
    is_draft: true,
    from_me: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("mail_messages")
    .insert(payload)
    .select()
    .maybeSingle();
  if (error) {
    throw new Error(`Internal draft insert failed: ${error.message}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const body = await req.json().catch(() => ({}));
    const shopId = typeof body?.shop_id === "string" ? body.shop_id.trim() : "";
    const provider = typeof body?.provider === "string" ? body.provider.trim() : "";
    const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
    const emailData: EmailData = body?.email_data ?? {};

    if (!shopId || !provider) {
      return new Response(JSON.stringify({ error: "shop_id og provider er påkrævet." }), {
        status: 400,
      });
    }

    const reasoningLogs: Array<{
      step_name: string;
      step_detail: string;
      status: string;
    }> = [];
    const context = await getAgentContext(shopId, emailData.fromEmail, emailData.subject);
    if (context?.orders?.length) {
      const order = context.orders[0];
      const orderLabel =
        order?.name ?? order?.order_number ?? order?.id ?? context.matchedSubjectNumber ?? "";
      reasoningLogs.push({
        step_name: "Shopify Lookup",
        step_detail: `Found Order ${orderLabel}`.trim(),
        status: "success",
      });
    } else {
      reasoningLogs.push({
        step_name: "Shopify Lookup",
        step_detail: "No order found",
        status: "warning",
      });
    }
    // Gatekeeper: spring over hvis mailen ikke skal behandles.
    const classification = await classifyEmail({
      from: emailData.from ?? "",
      subject: emailData.subject ?? "",
      body: emailData.body ?? "",
      headers: emailData.headers ?? [],
    });
    if (!classification.process) {
      emitDebugLog("generate-draft-unified: gatekeeper skip", {
        reason: classification.reason,
        category: classification.category,
      });
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: classification.reason,
          category: classification.category ?? null,
          explanation: classification.explanation ?? null,
        }),
        { status: 200 },
      );
    }

    const ownerUserId = await resolveShopOwnerId(shopId);
    const internalThread = await resolveInternalThread(ownerUserId, provider, emailData);
    const providerMessageId =
      typeof emailData.messageId === "string" ? emailData.messageId.trim() : "";
    if (supabase && ownerUserId && providerMessageId) {
      const { data, error } = await supabase
        .from("mail_messages")
        .select("ai_draft_text")
        .eq("user_id", ownerUserId)
        .eq("provider", provider)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (error) {
        console.warn("generate-draft-unified: dedupe lookup failed", error.message);
      } else if (data?.ai_draft_text?.trim()) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: "already_drafted" }),
          { status: 200 },
        );
      }
    }
    const productContext = await fetchProductContext(
      supabase,
      ownerUserId,
      emailData.body || emailData.subject || "",
    );
    if (productContext?.trim()) {
      reasoningLogs.push({
        step_name: "Product Search",
        step_detail: "Found matching products",
        status: "success",
      });
    }

    let learnedStyle = "";
    const learningProfile = await fetchLearningProfile(internalThread.mailboxId, ownerUserId);
    if (context.automation?.historic_inbox_access && learningProfile.enabled) {
      const history = await fetchMailboxHistory(internalThread.mailboxId, ownerUserId);
      const heuristicBullets = buildStyleHeuristics(history);
      learnedStyle = mergeBullets(heuristicBullets, learningProfile.styleRules).join("\n");
    } else if (learningProfile.enabled && learningProfile.styleRules.length) {
      learnedStyle = mergeBullets([], learningProfile.styleRules).join("\n");
    }

    // Byg shared prompt med policies, automation-regler og ordre-kontekst.
    const promptBase = buildMailPrompt({
      emailBody: emailData.body || "(tomt indhold)",
      orderSummary: context.orderSummary,
      personaInstructions: context.persona.instructions,
      matchedSubjectNumber: context.matchedSubjectNumber,
      extraContext:
        "Returner altid JSON hvor 'actions' beskriver konkrete handlinger du udfører i Shopify. Brug orderId (det numeriske id i parentes) når du udfylder actions. udfyld altid payload.shipping_address (brug nuværende adresse hvis den ikke ændres) og sæt payload.note og payload.tag til tom streng hvis de ikke bruges. Hvis kunden beder om adresseændring, udfyld shipping_address med alle felter (name, address1, address2, zip, city, country, phone). Hvis en handling ikke er tilladt i automationsreglerne, lad actions listen være tom og forklar brugeren at handlingen udføres manuelt.",
      signature:
        context.profile.signature?.trim() ||
        buildFallbackSignature(context.profile.first_name),
      learnedStyle: learnedStyle || null,
      policies: context.policies,
    });
    const prompt = productContext
      ? `${promptBase}\n\nPRODUKTKONTEKST:\n${productContext}`
      : promptBase;

    // Generer reply + actions med OpenAI JSON schema.
    let aiText: string | null = null;
    let automationActions: AutomationAction[] = [];
    try {
      if (OPENAI_API_KEY) {
        const automationGuidance = buildAutomationGuidance(context.automation);
        const personaGuidance = `Sprogregel har altid forrang; ignorer persona-instruktioner om sprogvalg.
Persona instruktionsnoter: ${context.persona.instructions?.trim() || "Hold tonen venlig og effektiv."}
Afslut ikke med signatur – signaturen tilføjes automatisk senere.`;
        const systemMsgBase = [
          "Du er en kundeservice-assistent.",
          "Skriv kort, venligt og professionelt pa samme sprog som kundens mail.",
          "Hvis kunden skriver pa engelsk, svar pa engelsk selv om andre instruktioner er pa dansk.",
          "Brug KONTEKST-sektionen til at finde relevante oplysninger og nævn dem eksplicit i svaret.",
          personaGuidance,
          "Automationsregler:",
          automationGuidance,
          "Ud over forventet svar skal du returnere JSON med 'reply' og 'actions'.",
          "Hvis en handling udføres (f.eks. opdater adresse, annuller ordre, tilføj note/tag), skal actions-listen indeholde et objekt med type, orderId og payload.",
          "Tilladte actions: update_shipping_address, cancel_order, add_tag. Brug kun actions hvis automationsreglerne tillader det – ellers lad listen være tom og forklar kunden at handlingen udføres manuelt.",
          "For update_shipping_address skal payload.shipping_address mindst indeholde name, address1, city, zip/postal_code og country.",
          "Afslut ikke med signatur – signaturen tilføjes automatisk senere.",
        ].join("\n");
        const systemMsg = context.matchedSubjectNumber
          ? systemMsgBase +
            ` Hvis KONTEKST indeholder et ordrenummer (fx #${context.matchedSubjectNumber}), brug dette ordrenummer som reference i svaret og spørg IKKE efter ordrenummer igen.`
          : systemMsgBase;
        const { reply, actions } = await callOpenAI(prompt, systemMsg);
        aiText = reply;
        automationActions = actions ?? [];
      } else {
        aiText = null;
      }
    } catch (e) {
      console.warn("OpenAI fejl", e?.message || e);
      aiText = null;
    }

    // Fallback hvis AI fejler eller er slået fra.
    if (!aiText) {
      aiText = `Hej,\n\nTak for din besked. Vi vender tilbage hurtigst muligt med en opdatering.`;
    }

    let finalText = aiText.trim();
    const signature =
      context.profile.signature?.trim() ||
      buildFallbackSignature(context.profile.first_name);
    if (signature && signature.length && !finalText.includes(signature)) {
      finalText = stripTrailingSignoff(finalText);
      finalText = `${finalText}\n\n${signature}`;
    }

    // Render HTML med konsistent styling og line breaks.
    const htmlBody = formatEmailBody(finalText);

    let draftDestination =
      context?.automation?.draft_destination === "sona_inbox"
        ? "sona_inbox"
        : "email_provider";
    if (supabase && ownerUserId) {
      const { data, error } = await supabase
        .from("agent_automation")
        .select("draft_destination")
        .eq("user_id", ownerUserId)
        .maybeSingle();
      if (error) {
        console.warn("generate-draft-unified: draft destination lookup failed", error.message);
      } else if (data?.draft_destination === "sona_inbox") {
        draftDestination = "sona_inbox";
      } else if (data?.draft_destination === "email_provider") {
        draftDestination = "email_provider";
      } else {
        draftDestination = "sona_inbox";
      }
    }

    if (provider === "smtp") {
      draftDestination = "sona_inbox";
    }

  let draftResponse: any = null;
  let internalDraft: any = null;
  let draftId: string | null = null;
  let threadId: string | null = null;
  let automationResults: Array<{ type: string; ok: boolean; orderId?: number; detail?: string; error?: string }> = [];

    if (draftDestination === "email_provider") {
      if (!accessToken) {
        return new Response(
          JSON.stringify({ error: "access_token er påkrævet for Gmail/Outlook." }),
          { status: 400 },
        );
      }
      if (provider === "gmail") {
        draftResponse = await createGmailDraft(accessToken, emailData, htmlBody);
      } else if (provider === "outlook") {
        draftResponse = await createOutlookDraft(accessToken, emailData, htmlBody);
      } else {
        return new Response(JSON.stringify({ error: "Unsupported provider." }), { status: 400 });
      }
      draftId = draftResponse?.id ?? draftResponse?.message?.id ?? null;
      threadId = draftResponse?.message?.threadId ?? emailData.threadId ?? null;
    } else {
      const internal = internalThread;
      if (!internal.threadId) {
        console.warn("generate-draft-unified: missing internal thread for draft");
      }
      internalDraft = await createInternalDraft({
        userId: ownerUserId,
        mailboxId: internal.mailboxId,
        threadId: internal.threadId,
        provider,
        subject: emailData.subject ? `Re: ${emailData.subject}` : "Re:",
        htmlBody,
        textBody: finalText,
      }).catch((err) => {
        console.warn("generate-draft-unified: internal draft failed", err?.message || err);
        return null;
      });
      draftId = internalDraft?.id ?? null;
      threadId = internal.threadId ?? emailData.threadId ?? null;
    }
    const customerEmail = emailData.fromEmail || emailData.from || null;
    const subject = emailData.subject || "";

    if (supabase && ownerUserId && threadId) {
      const { error: clearThreadDraftsError } = await supabase
        .from("mail_messages")
        .update({
          ai_draft_text: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", ownerUserId)
        .eq("thread_id", threadId);
      if (clearThreadDraftsError) {
        console.warn(
          "generate-draft-unified: failed clearing previous thread drafts",
          clearThreadDraftsError.message,
        );
      }
    }

    if (supabase && ownerUserId && emailData.messageId) {
      const { error: updateError } = await supabase
        .from("mail_messages")
        .update({
          ai_draft_text: finalText,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", ownerUserId)
        .eq("provider", provider)
        .eq("provider_message_id", emailData.messageId);
      if (updateError) {
        console.warn("generate-draft-unified: failed to store ai draft", updateError.message);
      }
    }

    // Log draft i Supabase til tracking.
    let loggedDraftId: number | null = null;
    if (supabase && threadId) {
      const { error: staleDraftsError } = await supabase
        .from("drafts")
        .update({ status: "superseded" })
        .eq("platform", provider)
        .eq("thread_id", threadId)
        .eq("status", "pending");
      if (staleDraftsError) {
        console.warn(
          "generate-draft-unified: failed to clear stale pending drafts",
          staleDraftsError.message,
        );
      }
      const { data, error } = await supabase
        .from("drafts")
        .insert({
          shop_id: shopId || null,
          customer_email: customerEmail,
          subject,
          platform: provider,
          status: "pending",
          draft_id: draftId,
          thread_id: threadId,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      loggedDraftId = typeof data?.id === "number" ? data.id : null;
      if (error) {
        console.warn("generate-draft-unified: failed to log draft", error.message);
      }
    }

    if (supabase && loggedDraftId && reasoningLogs.length) {
      const now = new Date().toISOString();
      const threadMarker = threadId ? ` |thread_id:${threadId}` : "";
      const rows = reasoningLogs.map((log) => ({
        draft_id: loggedDraftId,
        step_name: log.step_name,
        step_detail: `${log.step_detail}${threadMarker}`,
        status: log.status,
        created_at: now,
      }));
      const { error } = await supabase.from("agent_logs").insert(rows);
      if (error) {
        console.warn("generate-draft-unified: failed to log reasoning", error.message);
      }
    }

    // Udfør godkendte Shopify-actions fra model output.
    if (ownerUserId) {
      const orderIdMap: Record<string, number> = {};
      for (const order of context.orders ?? []) {
        const shopifyId = Number(order?.id ?? 0);
        if (!shopifyId || Number.isNaN(shopifyId)) continue;
        const orderNumber = order?.order_number ?? order?.orderNumber ?? null;
        const name = typeof order?.name === "string" ? order.name.trim() : "";
        const nameKey = name.replace("#", "");
        if (orderNumber) {
          orderIdMap[String(orderNumber)] = shopifyId;
        }
        if (nameKey) {
          orderIdMap[nameKey] = shopifyId;
        }
        orderIdMap[String(shopifyId)] = shopifyId;
      }

      automationResults = await executeAutomationActions({
        supabase,
        supabaseUserId: ownerUserId,
        actions: automationActions,
        automation: context.automation,
        tokenSecret: ENCRYPTION_KEY,
        apiVersion: SHOPIFY_API_VERSION,
        orderIdMap,
      });
      emitDebugLog("generate-draft-unified: automation results", automationResults);
    }

    if (supabase && loggedDraftId && automationResults.length) {
      const now = new Date().toISOString();
      const threadMarker = threadId ? ` |thread_id:${threadId}` : "";
      const rows = automationResults.map((result) => ({
        draft_id: loggedDraftId,
        step_name: "Shopify Action",
        step_detail: result.ok
          ? `${result.detail || `Executed ${result.type.replace(/_/g, " ")}.`}`.trim() +
            threadMarker
          : `Failed ${result.type.replace(/_/g, " ")}: ${result.error || "unknown error"}.` +
            threadMarker,
        status: result.ok ? "success" : "error",
        created_at: now,
      }));
      const { error } = await supabase.from("agent_logs").insert(rows);
      if (error) {
        console.warn("generate-draft-unified: failed to log automation results", error.message);
      }
    }

    if (supabase && loggedDraftId) {
      const threadMarker = threadId ? ` |thread_id:${threadId}` : "";
      const { error } = await supabase.from("agent_logs").insert({
        draft_id: loggedDraftId,
        step_name: "Context",
        step_detail: `Loaded Store Policies${threadMarker}`,
        status: "info",
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.warn("generate-draft-unified: failed to log policies", error.message);
      }
    }

    emitDebugLog("generate-draft-unified", {
      provider,
      shopId,
      draftId,
      threadId,
    });

    return new Response(JSON.stringify({ success: true, draftId }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    const message = err?.message || "Ukendt fejl";
    console.error("generate-draft-unified error:", message);
    return new Response(JSON.stringify({ error: message }), { status });
  }
});
