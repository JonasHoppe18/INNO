import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Automation, Persona } from "../_shared/agent-context.ts";
import {
  buildAutomationGuidance,
  fetchAutomation,
  fetchPersona,
  fetchPolicies,
  resolveSupabaseUserId,
} from "../_shared/agent-context.ts";
import {
  AutomationAction,
  executeAutomationActions,
} from "../_shared/automation-actions.ts";
import { buildOrderSummary, resolveOrderContext } from "../_shared/shopify.ts";
import { PERSONA_REPLY_JSON_SCHEMA } from "../_shared/openai-schema.ts";
import { buildMailPrompt } from "../_shared/prompt.ts";

/**
 * Gorgias -> Supabase webhook relay.
 *
 * Denne edge function svarer på de unikke webhook URLs vi deler i GorgiasSheet.
 * Vi logger webhook payloaden og finder den relevante Gorgias-integration i databasen,
 * så næste trin kan kalde AI og poste et draft-svar retur til Gorgias.
 */

const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
const GORGIAS_WEBHOOK_SECRET = Deno.env.get("GORGIAS_WEBHOOK_SECRET");

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";

const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – Gorgias webhook kan ikke slå data op.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – Gorgias webhook kan ikke læse Supabase tabeller.");
if (!OPENAI_API_KEY)
  console.warn("OPENAI_API_KEY mangler – Gorgias webhook kan ikke generere AI-udkast.");
if (!ENCRYPTION_KEY)
  console.warn("ENCRYPTION_KEY mangler – Shopify opslagsfunktionalitet kan fejle.");

type IntegrationRecord = {
  id: string;
  user_id: string;
  provider: string;
  is_active: boolean;
  config: Record<string, unknown> | null;
  credentials_enc: string | null;
};

const debugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) {
    console.log(...args);
  }
};

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
    status: init?.status ?? 200,
  });
}

function decodeCredentials(raw: string | null): string | null {
  if (!raw) return null;
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    console.warn("Gorgias webhook: credentials_enc havde uventet format.");
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

// Validerer webhook signaturen hvis secret er sat.
async function verifySignature(rawBody: string, req: Request): Promise<boolean> {
  if (!GORGIAS_WEBHOOK_SECRET) {
    return true;
  }

  const headerSig =
    req.headers.get("x-gorgias-signature") ??
    req.headers.get("X-Gorgias-Signature") ??
    "";
  if (!headerSig) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(GORGIAS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computed, headerSig.trim());
}

function timingSafeEqual(a: string, b: string) {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  if (bufA.length !== bufB.length) return false;
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

async function fetchGorgiasIntegration(clerkUserId: string): Promise<IntegrationRecord> {
  if (!supabase) {
    throw Object.assign(new Error("Supabase klient er ikke konfigureret på edge function."), {
      status: 500,
    });
  }

  const supabaseUserId = await resolveSupabaseUserId(supabase, clerkUserId);

  const { data, error } = await supabase
    .from("integrations")
    .select("id,user_id,provider,is_active,config,credentials_enc")
    .eq("user_id", supabaseUserId)
    .eq("provider", "gorgias")
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke hente Gorgias integration: ${error.message}`),
      { status: 500 },
    );
  }

  if (!data) {
    throw Object.assign(new Error("Der er ikke opsat Gorgias integration for denne bruger."), {
      status: 404,
    });
  }

  if (!data.is_active) {
    throw Object.assign(new Error("Gorgias integration er ikke aktiv."), {
      status: 409,
    });
  }

  return data as IntegrationRecord;
}

function buildBasicAuthHeader(email: string, apiKey: string): string {
  const token = btoa(`${email}:${apiKey}`);
  return `Basic ${token}`;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function extractGorgiasPayload(payload: any) {
  const ticket = payload?.ticket ?? payload?.data ?? payload ?? {};
  const message =
    payload?.message ??
    payload?.data?.message ??
    ticket?.last_message ??
    ticket?.messages?.[0] ??
    payload?.messages?.[0] ??
    {};

  const rawId =
    payload?.ticket_id ??
    payload?.ticketId ??
    ticket?.ticket_id ??
    ticket?.id ??
    message?.ticket_id;
  const ticketId = typeof rawId === "string" ? parseInt(rawId, 10) : rawId;

  const subject =
    normalizeText(ticket?.subject) ??
    normalizeText(payload?.subject) ??
    normalizeText(payload?.ticket_subject);

  const bodyText =
    normalizeText(message?.body_text) ??
    normalizeText(message?.body) ??
    normalizeText(payload?.body_text) ??
    normalizeText(payload?.body);

  const bodyHtml =
    normalizeText(message?.body_html) ??
    normalizeText(payload?.body_html) ??
    normalizeText(ticket?.description);

  const description = bodyText ?? (bodyHtml ? stripHtml(bodyHtml) : null);

  const contactEmail =
    normalizeText(message?.sender?.email) ??
    normalizeText(ticket?.customer?.email) ??
    normalizeText(ticket?.requester?.email) ??
    normalizeText(payload?.customer?.email) ??
    normalizeText(payload?.requester?.email) ??
    normalizeText(payload?.email);

  return { ticketId, subject, description, contactEmail };
}

type OpenAIResult = {
  reply: string | null;
  actions: AutomationAction[];
};

async function callOpenAI(prompt: string, system: string): Promise<OpenAIResult> {
  if (!OPENAI_API_KEY) return { reply: null, actions: [] };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: PERSONA_REPLY_JSON_SCHEMA,
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: 800,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (typeof payload?.error?.message === "string" && payload.error.message) ||
      `OpenAI svarede ${response.status}`;
    console.warn("Gorgias webhook: OpenAI fejl", message);
    return { reply: null, actions: [] };
  }

  const reply = payload?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    return { reply: null, actions: [] };
  }

  try {
    const parsed = JSON.parse(reply);
    const text = typeof parsed?.reply === "string" ? parsed.reply : null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.filter((action: any) => typeof action?.type === "string")
      : [];
    return { reply: text, actions };
  } catch {
    return { reply: null, actions: [] };
  }
}

async function generateDraftBody(options: {
  subject?: string | null;
  description?: string | null;
  persona: Persona;
  automation: Automation;
  orders: any[];
  contactEmail?: string | null;
  matchedSubjectNumber?: string | null;
  policies: Awaited<ReturnType<typeof fetchPolicies>>;
}): Promise<{ body: string; actions: AutomationAction[] }> {
  const orderSummary = buildOrderSummary(options.orders);
  const description =
    options.description?.trim()?.length ? options.description.trim() : "Ingen besked angivet.";
  const subject = options.subject?.trim() ?? "Ticket";
  const automationGuidance = buildAutomationGuidance(options.automation);
  const personaNotes = options.persona.instructions?.trim()
    ? options.persona.instructions.trim()
    : "Hold tonen venlig og effektiv.";

  const prompt = buildMailPrompt({
    emailBody: `Emne: ${subject}\n${description}`,
    orderSummary,
    personaInstructions: personaNotes,
    matchedSubjectNumber: options.matchedSubjectNumber,
    extraContext: [
      "Svar skal kunne sendes direkte til kunden via Gorgias.",
      options.contactEmail ? `Kundens e-mail: ${options.contactEmail}` : null,
    ]
      .filter(Boolean)
      .join(" "),
    signature: options.persona.signature,
    policies: options.policies,
  });

  const system = [
    "Du er en kundeservice-agent for INNO Desk.",
    "Skriv venligt, konkret og professionelt pa samme sprog som kundens mail.",
    "Hvis kunden skriver pa engelsk, svar pa engelsk selv om andre instruktioner er pa dansk.",
    "Du svarer ikke direkte til kunden, men udarbejder et kladde-svar som agenten kan sende.",
    "Inddrag ordreoplysninger fra konteksten når det er relevant.",
    "Hvis der ikke findes ordrer, så bed om flere detaljer eller ordrenummer.",
    "Afslut ikke med signatur – den bliver lagt på bagefter.",
    "Automationsregler:",
    automationGuidance,
  ].join("\n");

  const { reply, actions } = await callOpenAI(prompt, system);
  const fallback = [
    "Hej!",
    options.subject
      ? `Tak for din besked om \"${options.subject}\" – vi kigger på sagen og følger op snarest.`
      : "Tak for din besked – vi kigger på sagen og følger op snarest.",
    orderSummary.trim(),
    "Jeg vender tilbage så hurtigt som muligt med en opdatering.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let body = (reply || fallback || "").trim();
  const signature = options.persona.signature?.trim();
  if (signature && signature.length && !body.includes(signature)) {
    body = `${body}\n\n${signature}`;
  }
  return { body, actions };
}

async function createGorgiasDraftMessage(options: {
  domain: string;
  email: string;
  apiKey: string;
  ticketId: number;
  body: string;
  subject?: string | null;
}) {
  const { domain, email, apiKey, ticketId, body, subject } = options;
  const url = `https://${domain}/api/tickets/${ticketId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(email, apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email },
      body_text: body,
      subject: subject ?? undefined,
      channel: "api",
      source: "api",
      is_draft: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(
      new Error(`Gorgias draft API svarede ${response.status}: ${text}`),
      { status: 502 },
    );
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      console.error("Gorgias webhook fejl: userId mangler");
      return json({ error: "Missing userId in webhook URL" }, { status: 400 });
    }

    const rawBody = await req.text();
    let payload: any = rawBody;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = rawBody;
    }

    const signatureOk = await verifySignature(rawBody, req);
    if (!signatureOk) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const integration = await fetchGorgiasIntegration(userId);
    const apiKey = decodeCredentials(integration.credentials_enc ?? null);
    if (!apiKey) {
      throw Object.assign(new Error("Gorgias API nøgle mangler eller kunne ikke dekrypteres."), {
        status: 500,
      });
    }

    const { ticketId, subject, description, contactEmail } = extractGorgiasPayload(payload);

    if (!ticketId || Number.isNaN(ticketId)) {
      throw Object.assign(new Error("Webhook payload indeholdt ikke et gyldigt ticket id."), {
        status: 400,
      });
    }

    debugLog("Gorgias webhook", {
      userId,
      hasPayload: Boolean(payload),
      domainPresent: Boolean(integration.config?.domain),
      emailPresent: Boolean(integration.config?.email),
      hasApiKey: Boolean(apiKey),
    });

    if (!integration.config?.domain || typeof integration.config.domain !== "string") {
      throw Object.assign(new Error("Gorgias domæne mangler i integrationens config."), {
        status: 500,
      });
    }
    if (!integration.config?.email || typeof integration.config.email !== "string") {
      throw Object.assign(new Error("Gorgias email mangler i integrationens config."), {
        status: 500,
      });
    }
    if (!integration.user_id) {
      throw Object.assign(new Error("Integration mangler henvisning til Supabase user id."), {
        status: 500,
      });
    }

    const persona = await fetchPersona(supabase, integration.user_id);
    const automation = await fetchAutomation(supabase, integration.user_id);
    const policies = await fetchPolicies(supabase, integration.user_id);
    const { orders, matchedSubjectNumber } = await resolveOrderContext({
      supabase,
      userId: integration.user_id,
      email: contactEmail,
      subject,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });

    const { body: draftBody, actions } = await generateDraftBody({
      subject,
      description,
      persona,
      automation,
      orders,
      contactEmail,
      matchedSubjectNumber,
      policies,
    });

    await createGorgiasDraftMessage({
      domain: integration.config.domain,
      email: integration.config.email,
      apiKey,
      ticketId,
      body: draftBody,
      subject,
    });

    const automationResults = await executeAutomationActions({
      supabase,
      supabaseUserId: integration.user_id,
      actions,
      automation,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });
    console.log("🤖 Gorgias automation actions:", automationResults);

    return json({
      success: true,
      userId,
      autoReply: false,
      draftCreated: true,
      ordersReferenced: orders.length,
      automation: automationResults,
      integration: {
        id: integration.id,
        domain: integration.config?.domain ?? null,
        hasApiKey: Boolean(apiKey),
      },
      ticket: {
        id: ticketId,
      },
    });
  } catch (error) {
    const status =
      typeof (error as { status?: number })?.status === "number"
        ? (error as { status?: number }).status!
        : 500;
    const message = error instanceof Error ? error.message : "Internal error";
    console.error("Gorgias webhook fejl:", error);
    return json({ error: message }, { status });
  }
});
