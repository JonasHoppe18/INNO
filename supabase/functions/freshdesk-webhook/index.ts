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
 * Freshdesk -> Supabase webhook relay.
 *
 * Denne edge function svarer på de unikke webhook URLs vi deler i FreshdeskSheet.
 * Vi logger webhook payloaden og finder den relevante Freshdesk-integration i databasen,
 * så næste trin kan kalde AI og poste svar retur til Freshdesk.
 */

const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
const FRESHDESK_WEBHOOK_SECRET = Deno.env.get("FRESHDESK_WEBHOOK_SECRET");

// Miljøkonstanter - edge function bruger disse til at connecte til Supabase,
// kalde OpenAI og (valgfrit) slå op i Shopify.
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";

// Supabase klient initialiseres kun hvis både url og service key findes.
const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

if (!PROJECT_URL) console.warn("PROJECT_URL mangler – Freshdesk webhook kan ikke slå data op.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – Freshdesk webhook kan ikke læse Supabase tabeller.");
if (!OPENAI_API_KEY)
  console.warn("OPENAI_API_KEY mangler – Freshdesk webhook kan ikke generere AI-udkast.");
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

type FreshdeskWebhookPayload = {
  freshdesk_webhook?: {
    ticket_id?: number | string;
    ticket_subject?: string | null;
    ticket_description?: string | null;
    ticket_contact_email?: string | null;
  };
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

// Dekrypterer credentials_enc (hex lagret i DB) til almindelig tekst.
// Returnerer null hvis formatet er forkert.
function decodeCredentials(raw: string | null): string | null {
  if (!raw) return null;
  const hex = raw.startsWith("\\x") ? raw.slice(2) : raw;
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    console.warn("Freshdesk webhook: credentials_enc havde uventet format.");
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

// Validerer Freshdesk-webhook via HMAC-SHA256 af rå body med delt secret
async function verifySignature(rawBody: string, req: Request): Promise<boolean> {
  if (!FRESHDESK_WEBHOOK_SECRET) {
    console.warn("FRESHDESK_WEBHOOK_SECRET mangler – webhook kan ikke verificeres.");
    return false;
  }

  const headerSig =
    req.headers.get("x-freshdesk-signature") ??
    req.headers.get("X-Freshdesk-Signature") ??
    "";
  if (!headerSig) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(FRESHDESK_WEBHOOK_SECRET),
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

// Hent Freshdesk integration fra integrations-tabellen for en given Clerk user id.
// Funktion kaster et Error-objekt med .status ved problemer (404, 409, 500).
async function fetchFreshdeskIntegration(clerkUserId: string): Promise<IntegrationRecord> {
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
    .eq("provider", "freshdesk")
    .maybeSingle();

  if (error) {
    throw Object.assign(
      new Error(`Kunne ikke hente Freshdesk integration: ${error.message}`),
      { status: 500 },
    );
  }

  if (!data) {
    throw Object.assign(new Error("Der er ikke opsat Freshdesk integration for denne bruger."), {
      status: 404,
    });
  }

  if (!data.is_active) {
    throw Object.assign(new Error("Freshdesk integration er ikke aktiv."), {
      status: 409,
    });
  }

  return data as IntegrationRecord;
}

// Bygger Basic Authorization header som Freshdesk forventer (apiKey:X)
function buildBasicAuthHeader(apiKey: string): string {
  const token = btoa(`${apiKey}:X`);
  return `Basic ${token}`;
}

// Simpel HTML-escaping for at undgå injektion i den HTML-note vi poster.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Bygger en pæn HTML-note der inkluderes som bodyHtml i Freshdesk API-opkaldet.
// Vi bruger escapeHtml og konverterer linjeskift til <br>.
function buildNoteHtml(body: string): string {
  const escapedBody = escapeHtml(body).replace(/\n/g, "<br>");
  return `
    <div style="background-color:#f0f9ff;border-left:4px solid #3b82f6;padding:12px;font-family:sans-serif;color:#1e293b;">
      <div style="font-weight:bold;color:#1e40af;margin-bottom:8px;display:flex;align-items:center;gap:5px;">
        Sona.ai forslag
      </div>
      <div style="font-size:14px;line-height:1.6;">
        ${escapedBody}
      </div>
      <div style="margin-top:12px;padding-top:8px;border-top:1px solid #bfdbfe;font-size:12px;color:#64748b;">
        <em>Kopier teksten ovenfor og send som svar.</em>
      </div>
    </div>
  `.trim();
}

type OpenAIResult = {
  reply: string | null;
  actions: AutomationAction[];
};

// Wrapper til at kalde OpenAI chat/completions med json_schema response_format.
// Returnerer parsed reply og eventuelle automation actions hvis succes.
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
    console.warn("Freshdesk webhook: OpenAI fejl", message);
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

// Genererer kladde-tekst til Freshdesk baseret på persona, automation og ordrer.
// Returnerer både body-tekst og eventuelle automation actions som OpenAI foreslår.
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
    options.description?.trim()?.length ? options.description.trim() : "Ingen beskrivelse angivet.";
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
      "Svar skal kunne sendes direkte til kunden via Freshdesk.",
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

// Opretter en privat draft-note på en Freshdesk ticket via Freshdesk API.
// Kaster fejl hvis API'et ikke svarer med OK.
async function createFreshdeskDraftNote(options: {
  domain: string;
  apiKey: string;
  ticketId: number;
  body: string;
  bodyHtml?: string;
}) {
  const { domain, apiKey, ticketId, body, bodyHtml } = options;
  const url = `https://${domain}/api/v2/tickets/${ticketId}/notes`;

  const payloadBody = bodyHtml ?? body;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: payloadBody,
      private: true,
      incoming: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(
      new Error(`Freshdesk note API svarede ${response.status}: ${text}`),
      { status: 502 },
    );
  }
}

// Hovedhandler for incoming webhook POST-requests fra Freshdesk.
// Forventet URL-format: /?userId=<clerkUserId>
// Flow:
// 1) Valider request og userId query param
// 2) Parse payload (JSON hvis muligt)
// 3) Hent integration, dekrypter API key
// 4) Indhent persona/automation/policies + ordre-kontekst
// 5) Generer kladde via OpenAI og opret en privat note i Freshdesk
// 6) Udfør eventuelle automation-actions (labels, ordre-opdateringer osv.)
// 7) Returner et JSON-svar med status og metadata
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      console.error("Freshdesk webhook fejl: userId mangler");
      return json({ error: "Missing userId in webhook URL" }, { status: 400 });
    }

    // Læs body som tekst og prøv at parse JSON — fallback til rå tekst
    const rawBody = await req.text();
    let payload: FreshdeskWebhookPayload | string = rawBody;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = rawBody;
    }

    const signatureOk = await verifySignature(rawBody, req);
    if (!signatureOk) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    // Hent integration og dekrypter API-nøglen (hex -> tekst)
    const integration = await fetchFreshdeskIntegration(userId);
    const apiKey = decodeCredentials(integration.credentials_enc ?? null);
    if (!apiKey) {
      throw Object.assign(new Error("Freshdesk API nøgle mangler eller kunne ikke dekrypteres."), {
        status: 500,
      });
    }

    const webhook = (payload as FreshdeskWebhookPayload)?.freshdesk_webhook;
    const ticketIdRaw = webhook?.ticket_id;
    const ticketId = typeof ticketIdRaw === "string" ? parseInt(ticketIdRaw, 10) : ticketIdRaw;

    if (!ticketId || Number.isNaN(ticketId)) {
      throw Object.assign(new Error("Webhook payload indeholdt ikke et gyldigt ticket id."), {
        status: 400,
      });
    }

    debugLog("Freshdesk webhook", {
      userId,
      hasPayload: Boolean(payload),
      domainPresent: Boolean(integration.config?.domain),
      hasApiKey: Boolean(apiKey),
    });

    if (!integration.config?.domain || typeof integration.config.domain !== "string") {
      throw Object.assign(
        new Error("Freshdesk domæne mangler i integrationens config."),
        { status: 500 },
      );
    }
    if (!integration.user_id) {
      throw Object.assign(
        new Error("Integration mangler henvisning til Supabase user id."),
        { status: 500 },
      );
    }

    // Hent persona, automation rules og policy-tekster fra DB
    const persona = await fetchPersona(supabase, integration.user_id);
    const automation = await fetchAutomation(supabase, integration.user_id);
    const policies = await fetchPolicies(supabase, integration.user_id);
    const { orders, matchedSubjectNumber } = await resolveOrderContext({
      supabase,
      userId: integration.user_id,
      email: webhook?.ticket_contact_email,
      subject: webhook?.ticket_subject,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });

    // Generer kladde (tekst) og modtag eventuelle automation actions
    const { body: draftBody, actions } = await generateDraftBody({
      subject: webhook?.ticket_subject,
      description: webhook?.ticket_description,
      persona,
      automation,
      orders,
      contactEmail: webhook?.ticket_contact_email,
      matchedSubjectNumber,
      policies,
    });

    const formattedHtml = buildNoteHtml(draftBody);

    // Opret en privat note (draft) i Freshdesk
    await createFreshdeskDraftNote({
      domain: integration.config.domain,
      apiKey,
      ticketId,
      body: draftBody,
      bodyHtml: formattedHtml,
    });

    // Udfør automation actions (labels, ordre-opdateringer osv.)
    const automationResults = await executeAutomationActions({
      supabase,
      supabaseUserId: integration.user_id,
      actions,
      automation,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });
    console.log("🤖 Freshdesk automation actions:", automationResults);

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
    console.error("Freshdesk webhook fejl:", error);
    return json({ error: message }, { status });
  }
});
