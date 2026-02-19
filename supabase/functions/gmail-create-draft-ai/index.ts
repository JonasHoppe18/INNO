// Clerk klient til at hente OAuth tokens
// JWT validering mod Clerk
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
// Supabase klient til DB opslag
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAutomationGuidance,
  fetchAutomation,
  fetchPersona,
  fetchPolicies,
  resolveSupabaseUserId,
} from "../_shared/agent-context.ts";
import { AutomationAction, executeAutomationActions } from "../_shared/automation-actions.ts";
import { buildOrderSummary, resolveOrderContext } from "../_shared/shopify.ts";
import { resolveShopId } from "../_shared/shops.ts";
import { PERSONA_REPLY_JSON_SCHEMA } from "../_shared/openai-schema.ts";
import { buildMailPrompt } from "../_shared/prompt.ts";
import { classifyEmail } from "../_shared/classify-email.ts";
import { formatEmailBody } from "../_shared/email.ts";

/**
 * Gmail Create Draft AI
 * ---------------------
 * Edge function der henter en Gmail-besked, kører AI for at generere et
 * udkast (baseret på persona, automation-regler og ordre-kontekst) og
 * opretter et draft i brugerens Gmail via Gmail API.
 *
 * Flowet:
 * - Valider auth / intern caller
 * - Hent supabase context (persona, automation, policies)
 * - Hent besked fra Gmail
 * - Reslover ordrer og produktkontekst
 * - Kald OpenAI for at generere reply + handlinger
 * - Opret draft i Gmail og returner metadata
 */

// Base URL til Gmail API
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
// Intern edge function til Shopify ordrer
const SHOPIFY_ORDERS_FN = "/functions/v1/shopify-orders";
// Slå debug logs til/fra via env
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
// Lille helper så vi kan slå debug-logning til/fra uden at ændre resten af koden - Det brugte meget data i supabase
const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) {
    console.log(...args);
  }
};

// Miljøvariabler til auth og integrationer
const CLERK_JWT_ISSUER = Deno.env.get("CLERK_JWT_ISSUER");
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";
const INTERNAL_AGENT_SECRET = Deno.env.get("INTERNAL_AGENT_SECRET");
const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

// Log tydelige advarsler ved manglende config
if (!CLERK_JWT_ISSUER) console.warn("CLERK_JWT_ISSUER mangler (Supabase secret).");
if (!PROJECT_URL) console.warn("PROJECT_URL mangler – kan ikke kalde interne functions.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – gmail-create-draft-ai kan ikke læse Supabase tabeller.");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY mangler – AI udkast vil kun bruge fallback.");
if (!Deno.env.get("OPENAI_MODEL")) console.warn("OPENAI_MODEL mangler – bruger default gpt-4o-mini.");
if (!ENCRYPTION_KEY)
  console.warn("ENCRYPTION_KEY mangler – direkte Shopify-opslag fra interne kald kan fejle.");
if (!INTERNAL_AGENT_SECRET)
  console.warn("INTERNAL_AGENT_SECRET mangler – interne automatiske kald er ikke sikret.");
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
  console.warn("GOOGLE_CLIENT_ID/SECRET mangler – gmail-create-draft-ai kan ikke forny tokens.");

// JWKS til JWT validering fra Clerk
const JWKS = CLERK_JWT_ISSUER
  ? createRemoteJWKSet(new URL(`${CLERK_JWT_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`))
  : null;
// Supabase client med service role for server-side queries
const supabase =
  PROJECT_URL && SERVICE_ROLE_KEY ? createClient(PROJECT_URL, SERVICE_ROLE_KEY) : null;

type OpenAIResult = {
  reply: string | null;
  actions: AutomationAction[];
};

function encodeToken(value: string): string {
  return btoa(value);
}

function decodeToken(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("\\x")) {
    const hex = value.slice(2);
    if (!hex || hex.length % 2 !== 0) return null;
    let out = "";
    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
  try {
    return atob(value);
  } catch {
    return value;
  }
}

// Laver embeddings så vi kan matche produkter mod mailindholdet
async function embedText(input: string): Promise<number[]> {
  // Stop hvis OpenAI ikke er konfigureret
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
  // Kald embeddings endpoint
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
  // Forsøg at parse JSON svar
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // Fejl fra OpenAI
    throw new Error(json?.error?.message || `OpenAI embedding error ${res.status}`);
  }
  // Udtræk embedding-vektor
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) throw new Error("OpenAI embedding missing");
  return vector;
}

// Henter produktbeskrivelser fra Supabase via vector search for mere kontekst
async function fetchProductContext(
  supabaseClient: ReturnType<typeof createClient> | null,
  shopRefId: string | null,
  text: string,
) {
  // Hvis vi mangler data, returner tom tekst
  if (!supabaseClient || !shopRefId || !text?.trim()) return "";
  try {
    // Embed den første del af teksten for at spare tokens
    const embedding = await embedText(text.slice(0, 4000));
    // Kald RPC der matcher produkter
    const { data, error } = await supabaseClient.rpc("match_products", {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 5,
      filter_shop_id: shopRefId,
    });
    // Returner tom hvis ingen matches
    if (error || !Array.isArray(data) || !data.length) return "";
    return data
      .map((item: any) => {
        // Byg linje med produktinfo
        const price = item?.price ? `Price: ${item.price}.` : "";
        return `Product: ${item?.title ?? "Unknown"}. ${price} Details: ${item?.description ?? ""}`;
      })
      .join("\n");
  } catch (err) {
    // Log og returner tom kontekst ved fejl
    console.warn("gmail-create-draft-ai: product context failed", err);
    return "";
  }
}

// Udtrækker Clerk bearer token fra headers
function getBearerToken(req: Request): string {
  // Læs authorization header
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  // Match "Bearer <token>"
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error("Missing Clerk session token"), { status: 401 });
  return match[1];
}

// Tillader gmail-poll at kalde funktionen uden Clerk-session via delt secret
function isInternalAutomationRequest(req: Request): boolean {
  if (!INTERNAL_AGENT_SECRET) return false;
  // Tjek mulige header-navne for internal secret
  const candidate =
    req.headers.get("x-internal-secret") ??
    req.headers.get("X-Internal-Secret") ??
    req.headers.get("x-automation-secret") ??
    req.headers.get("X-Automation-Secret");
  // Returner om secret matcher
  return candidate === INTERNAL_AGENT_SECRET;
}

// Parse JSON-body men returner tomt objekt ved fejl
async function readJsonBody(req: Request) {
  try {
    // Forsøg at parse JSON
    return await req.json();
  } catch {
    // Returner tomt objekt ved fejl
    return {};
  }
}

// Verificerer Clerk JWT og returnerer userId (sub)
async function requireUserIdFromJWT(req: Request): Promise<string> {
  if (!JWKS || !CLERK_JWT_ISSUER) {
    throw Object.assign(new Error("JWT verify ikke konfigureret (CLERK_JWT_ISSUER mangler)"), { status: 500 });
  }
  // Hent bearer token fra request
  const token = getBearerToken(req);
  // Verificer token mod JWKS
  const { payload } = await jwtVerify(token, JWKS, { issuer: CLERK_JWT_ISSUER });
  // Udtræk bruger-id fra token
  const userId = payload?.sub;
  if (!userId || typeof userId !== "string") {
    throw Object.assign(new Error("Ugyldigt token: mangler user id"), { status: 401 });
  }
  return userId;
}

async function getFreshGmailAccessToken(userId: string): Promise<string> {
  if (!supabase) throw Object.assign(new Error("Supabase klient ikke konfigureret"), { status: 500 });
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("access_token_enc, refresh_token_enc, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }
  const accessToken = decodeToken((data as any)?.access_token_enc ?? null);
  const refreshToken = decodeToken((data as any)?.refresh_token_enc ?? null);
  if (!accessToken || !refreshToken) {
    throw Object.assign(new Error("Ingen Gmail credentials fundet for user."), { status: 404 });
  }

  const expiresAt =
    typeof (data as any)?.token_expires_at === "string"
      ? Date.parse((data as any).token_expires_at)
      : NaN;
  const expiresSoon = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 60_000;
  if (!expiresSoon) return accessToken;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw Object.assign(new Error("Google OAuth config mangler til token refresh."), { status: 500 });
  }

  const params = new URLSearchParams();
  params.set("client_id", GOOGLE_CLIENT_ID);
  params.set("client_secret", GOOGLE_CLIENT_SECRET);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Token refresh fejlede: ${message}`), { status: 502 });
  }
  const nextAccessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) {
    throw Object.assign(new Error("Token refresh mangler access_token"), { status: 502 });
  }
  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  const { error: updateError } = await supabase
    .from("mail_accounts")
    .update({
      access_token_enc: encodeToken(nextAccessToken),
      token_expires_at: nextExpiresAt,
    })
    .eq("user_id", userId)
    .eq("provider", "gmail");
  if (updateError) {
    console.warn("gmail-create-draft-ai: failed to update tokens", updateError.message);
  }

  return nextAccessToken;
}


// Dekoder Gmail base64-url encodede dele til tekst
function decodeBase64Url(data: string): string {
  // Konverter URL-safe base64 til normal base64
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  // Pad til korrekt længde
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  // Dekod til binary string
  const binaryString = atob(padded);
  try {
    // Forsøg at dekode til UTF-8
    return decodeURIComponent(escape(binaryString));
  } catch {
    // Fallback til rå string
    return binaryString;
  }
}

// Finder plaintext fra Gmail MIME payload (fallback til HTML-strip)
function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return "";
  // Brug body direkte hvis der er data
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const mime = part?.mimeType ?? "";
      // Rekursiv søgning i nested parts
      const value = extractPlainTextFromPayload(part);
      if (!value) continue;
      if (mime.includes("text/plain")) return value;
      if (mime.includes("text/html")) return value.replace(/<[^>]*>/g, " ").trim();
      return value;
    }
  }
  return "";
}

function stripTrailingSignoff(text: string): string {
  // Mulige signatur-fraser vi vil fjerne
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
  // Del tekst op i linjer
  const lines = text.split("\n");
  let i = lines.length - 1;
  // Skip tomme linjer i bunden
  while (i >= 0 && !lines[i].trim()) i -= 1;
  if (i < 0) return text;
  const last = lines[i].trim().toLowerCase();
  if (closings.includes(last)) {
    // Fjern signatur-linjen
    lines.splice(i, 1);
    // Fjern evt. tomme linjer bagefter
    while (lines.length && !lines[lines.length - 1].trim()) {
      lines.pop();
    }
    return lines.join("\n");
  }
  return text;
}

// Henter fuld Gmail-besked (payload) med auth token
async function fetchGmailMessage(messageId: string, token: string) {
  // Byg URL til Gmail API
  const url = `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`;
  // Kald Gmail API
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // Læs fejltekst for bedre log
    const text = await res.text();
    throw Object.assign(new Error(`Gmail message fetch failed: ${text || res.status}`), { status: res.status });
  }
  // Returner JSON payload
  return await res.json();
}

// Opretter Gmail draft ud fra rå MIME tekst
async function createGmailDraft(rawMessage: string, token: string, threadId?: string) {
  // Konverter tekst til base64url som Gmail kræver
  const toBase64Url = (input: string) => {
    const b64 = btoa(unescape(encodeURIComponent(input)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  // Byg payload til Gmail API
  const payload: any = { message: { raw: toBase64Url(rawMessage) } };
  if (threadId) payload.message.threadId = threadId;
  // Kald Gmail API for at oprette draft
  const res = await fetch(`${GMAIL_BASE}/drafts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Læs tekst først så vi kan parse og logge fejl
  const text = await res.text();
  let json: any = null;
  // Prøv at parse JSON hvis muligt
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw Object.assign(new Error(`Gmail draft failed: ${text || res.status}`), { status: res.status });
  return json;
}

// Kalder OpenAI med JSON schema så vi får reply + handlinger
async function callOpenAI(prompt: string, system?: string): Promise<OpenAIResult> {
  // Returner tomt svar hvis OpenAI ikke er aktivt
  if (!OPENAI_API_KEY) return { reply: null, actions: [] };
  const messages: any[] = [];
  // System prompt først
  if (system) messages.push({ role: "system", content: system });
  // Bruger prompt til sidst
  messages.push({ role: "user", content: prompt });
  // Body med schema-response så vi får struktureret JSON
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
  // Kald OpenAI chat endpoint
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Parse JSON svar
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  // Læs content fra første choice
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { reply: null, actions: [] };
  }
  try {
    // Parse den JSON vi bad om
    const parsed = JSON.parse(content);
    const reply = typeof parsed?.reply === "string" ? parsed.reply : null;
    const actions = Array.isArray(parsed?.actions)
      ? parsed.actions.filter((action: any) => typeof action?.type === "string")
      : [];
    return { reply, actions };
  } catch (_err) {
    // Hvis parsing fejler returner tomt svar
    return { reply: null, actions: [] };
  }
}

Deno.serve(async (req) => {
  try {
    // Kun POST er tilladt
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    // Læs body som JSON (kan være tom)
    const body = await readJsonBody(req);
    // Tjek om kaldet er internt
    const internalRequest = isInternalAutomationRequest(req);

    let clerkToken: string | null = null;
    let supabaseUserId: string | null = null;
    if (internalRequest) {
      // Ved interne kald forventes userId i body
      const providedUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
      if (!INTERNAL_AGENT_SECRET) {
        return new Response(JSON.stringify({ error: "Internt secret ikke konfigureret" }), {
          status: 500,
        });
      }
      if (!providedUserId) {
        return new Response(JSON.stringify({ error: "userId mangler for internt kald" }), {
          status: 400,
        });
      }
      // Brug userId fra payload
      supabaseUserId = providedUserId;
    } else {
      // Almindeligt kald: brug JWT fra Authorization
      clerkToken = getBearerToken(req);
      const clerkUserId = await requireUserIdFromJWT(req);
      if (supabase) {
        try {
          // Find supabase user id ud fra Clerk bruger
          supabaseUserId = await resolveSupabaseUserId(supabase, clerkUserId);
        } catch (err) {
          console.warn(
            "gmail-create-draft-ai: kunne ikke hente supabase user id",
            err?.message || err,
          );
        }
      }
    }
    if (!supabaseUserId) {
      return new Response(JSON.stringify({ error: "supabase user id mangler" }), { status: 400 });
    }
    // Hent kontekst: persona, automation og policies
    const persona = await fetchPersona(supabase, supabaseUserId);
    const automation = await fetchAutomation(supabase, supabaseUserId);
    const policies = await fetchPolicies(supabase, supabaseUserId);
    // Hent OAuth token til Gmail
    const gmailToken = await getFreshGmailAccessToken(supabaseUserId);

    // messageId er obligatorisk
    const messageId = typeof body?.messageId === "string" ? body.messageId : null;
    if (!messageId) return new Response(JSON.stringify({ error: "messageId mangler" }), { status: 400 });

    // Hent mail fra Gmail
    const message = await fetchGmailMessage(messageId, gmailToken);
    const headers = message.payload?.headers ?? [];
    // Læs afsender og emne fra headers
    const from = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value ?? "";
    const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value ?? "Svar";
    const threadId = message.threadId ?? null;
    // Uddrag plain text fra MIME payload
    const plain = extractPlainTextFromPayload(message.payload);

    // Find afsender-mail hvis muligt
    const emailMatch = from.match(/<([^>]+)>/);
    const fromEmail = emailMatch ? emailMatch[1] : (from.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i) ?? [null, null])[1];

    // Klassificer mail for at se om vi skal svare
    const classification = await classifyEmail({
      from,
      subject,
      body: plain,
      headers,
    });
    if (!classification.process) {
      // Log debug og returner "skipped"
      emitDebugLog("gmail-create-draft-ai: gatekeeper skip", {
        reason: classification.reason,
        category: classification.category,
      });
      return Response.json(
        {
          success: true,
          skipped: true,
          reason: classification.reason,
          category: classification.category ?? null,
          explanation: classification.explanation ?? null,
        },
        { status: 200 },
      );
    }

    // Hvis vi har et Clerk-token tilgængeligt kan vi bruge en intern frontend
    // proxy til at hente ordrer (bruges som fallback når direkte shopify access mangler).
    const fetchOrdersWithFrontendToken =
      clerkToken && PROJECT_URL
        ? async (email?: string | null) => {
            try {
              // Byg URL til shopify-orders function
              const url = new URL(`${PROJECT_URL}${SHOPIFY_ORDERS_FN}`);
              if (email?.trim()) url.searchParams.set("email", email.trim());
              url.searchParams.set("limit", "5");
              // Kald med Clerk token
              const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${clerkToken}` },
              });
              if (!res.ok) return null;
              // Parse og returner orders array
              const json = await res.json().catch(() => null);
              return Array.isArray(json?.orders) ? json.orders : null;
            } catch (err) {
              console.warn("gmail-create-draft-ai: shopify-orders fetch fejlede", err);
              return null;
            }
          }
        : null;

    // Hent ordre-kontekst baseret på e-mail og emne
    const { orders, matchedSubjectNumber } = await resolveOrderContext({
      supabase,
      userId: supabaseUserId,
      email: fromEmail,
      subject,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
      fetcher: fetchOrdersWithFrontendToken ?? undefined,
    });
    emitDebugLog("gmail-create-draft-ai: order context", {
      email: fromEmail,
      orders: orders.length,
      matchedSubjectNumber,
    });
    const shopRefId = await resolveShopId(supabase, { ownerUserId: supabaseUserId });

    // Byg kort resume af ordrer
    const orderSummary = buildOrderSummary(orders);
    // Hent ekstra produktkontekst via embeddings
    const productContext = await fetchProductContext(
      supabase,
      shopRefId,
      plain || subject || ""
    );

    // Byg base prompt til OpenAI: med email-tekst, ordre-resume, persona-instruktioner og policies.
    const promptBase = buildMailPrompt({
      emailBody: plain,
      orderSummary,
      personaInstructions: persona.instructions,
      matchedSubjectNumber,
      extraContext:
        "Returner altid JSON hvor 'actions' beskriver konkrete handlinger du udfører i Shopify. Brug orderId (det numeriske id i parentes) når du udfylder actions. For payload: udfyld kun de felter der er nødvendige for handlingen. Hvis kunden beder om adresseændring, udfyld shipping_address med alle felter du kender (name, address1, address2, zip, city, country, phone). Ved edit_line_items skal du bruge line_item_id/variant_id fra KONTEKST. Hvis en handling ikke er tilladt i automationsreglerne, må du stadig returnere handlingen i actions; systemet markerer den til manuel approval i tråden.",
      signature: persona.signature,
      policies,
    });
    // Tilføj produktkontekst hvis vi har det
    const prompt = productContext
      ? `${promptBase}\n\nPRODUKTKONTEKST:\n${productContext}`
      : promptBase;

    // Kald OpenAI (eller fallback) for at få forslag til svar og eventuelle automation actions
    let aiText: string | null = null;
    let automationActions: AutomationAction[] = [];
    try {
      if (OPENAI_API_KEY) {
        // Byg guidance til automation og persona
        const automationGuidance = buildAutomationGuidance(automation);
        const personaGuidance = `Sprogregel har altid forrang; ignorer persona-instruktioner om sprogvalg.
Persona instruktionsnoter: ${persona.instructions?.trim() || "Hold tonen venlig og effektiv."}
Afslut ikke med signatur – signaturen tilføjes automatisk senere.`;
        // System prompt med regler og schema
        const systemMsgBase = [
          "Du er en kundeservice-assistent.",
          "Skriv kort, venligt og professionelt pa samme sprog som kundens mail.",
          "Hvis kunden skriver pa engelsk, svar pa engelsk selv om andre instruktioner er pa dansk.",
          "Brug KONTEKST-sektionen til at finde relevante oplysninger og nævn dem eksplicit i svaret.",
          personaGuidance,
          "Automationsregler:",
          automationGuidance,
          "Ud over forventet svar skal du returnere JSON med 'reply' og 'actions'.",
          "Hvis en handling udføres (f.eks. opdater adresse, annuller ordre, refund, hold, line item edit, opdater kontakt, resend invoice, tilføj note/tag), skal actions-listen indeholde et objekt med type, orderId og payload.",
          "Tilladte actions: update_shipping_address, cancel_order, refund_order, change_shipping_method, hold_or_release_fulfillment, edit_line_items, update_customer_contact, add_note, add_tag, add_internal_note_or_tag, resend_confirmation_or_invoice.",
          "For update_shipping_address skal payload.shipping_address mindst indeholde name, address1, city, zip/postal_code og country.",
          "For edit_line_items skal payload.operations bruges med type: set_quantity/remove_line_item/add_variant samt line_item_id/variant_id og quantity.",
          "Afslut ikke med signatur – signaturen tilføjes automatisk senere.",
        ].join("\n");
        // Tilføj info om ordrenummer hvis vi fandt det
        const systemMsg = matchedSubjectNumber
          ? systemMsgBase + ` Hvis KONTEKST indeholder et ordrenummer (fx #${matchedSubjectNumber}), brug dette ordrenummer som reference i svaret og spørg IKKE efter ordrenummer igen.`
          : systemMsgBase;
        // Kald OpenAI og hent reply/actions
        const { reply, actions } = await callOpenAI(prompt, systemMsg);
        aiText = reply;
        automationActions = actions ?? [];
      } else {
        // Ingen OpenAI = fallback
        aiText = null;
      }
    } catch (e) {
      // Log fejl og brug fallback
      console.warn("OpenAI fejl", e?.message || e);
      aiText = null;
    }

    if (!aiText) {
      // Fallback tekst hvis AI ikke svarer
      aiText = `Hej ${from.split(" <")[0] || "kunde"},\n\nTak for din besked. Jeg har kigget på din sag${
        orders.length ? ` og fandt ${orders.length} ordre(r) relateret til din e-mail.` : "."
      }\n\n${orderSummary}\nVi vender tilbage hurtigst muligt med en opdatering.`;
    }
    // Ryd op i whitespace og tilføj signatur
    let finalText = aiText.trim();
    const signature = persona.signature?.trim();
    if (signature && signature.length && !finalText.includes(signature)) {
      // Fjern evt. signatur fra AI så vi ikke får dobbelt
      finalText = stripTrailingSignoff(finalText);
      // Tilføj signatur manuelt
      finalText = `${finalText}\n\n${signature}`;
    }
    aiText = finalText;
    const htmlBody = formatEmailBody(aiText);

    if (supabase && supabaseUserId && messageId) {
      const { error: updateError } = await supabase
        .from("mail_messages")
        .update({
          ai_draft_text: finalText,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", supabaseUserId)
        .eq("provider", "gmail")
        .eq("provider_message_id", messageId);
      if (updateError) {
        console.warn("gmail-create-draft-ai: failed to store ai draft", updateError.message);
      }
    }

    // Opret et draft i Gmail
    const rawLines = [] as string[];
    rawLines.push(`To: ${fromEmail || from}`);
    rawLines.push(`Subject: Re: ${subject}`);
    if (threadId) {
      // Behold svar-tråd i Gmail
      rawLines.push(`In-Reply-To: ${messageId}`);
      rawLines.push(`References: ${messageId}`);
    }
    // MIME header for HTML
    rawLines.push("Content-Type: text/html; charset=utf-8");
    rawLines.push("");
    // Selve mail-teksten
    rawLines.push(htmlBody);
    const rawMessage = rawLines.join("\r\n");

    // Opret draft i Gmail
    const draft = await createGmailDraft(rawMessage, gmailToken, threadId ?? undefined);
    // Log draft i Supabase async
    const draftInsertPromise = (async () => {
      if (!supabase || !supabaseUserId) return;
      if (!shopRefId) {
        console.warn("gmail-create-draft-ai: no shop id found, skipping draft log");
        return;
      }
      // Indsæt draft metadata i DB
      const { error } = await supabase.from("drafts").insert({
        shop_id: shopRefId,
        customer_email: fromEmail || from,
        subject,
        platform: "gmail",
        status: "pending",
        draft_id: draft?.id ?? null,
        message_id: draft?.message?.id ?? null,
        thread_id: draft?.message?.threadId ?? threadId ?? null,
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.warn("gmail-create-draft-ai: failed to log draft", error.message);
      }
    })();
    // Udfør eventuelle automation actions i Shopify
    const automationResults = await executeAutomationActions({
      supabase,
      supabaseUserId,
      actions: automationActions,
      automation,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });
    emitDebugLog("gmail-create-draft-ai: automation results", automationResults);

    // Vent på at draft loggen er færdig
    await draftInsertPromise;

    // Returner success payload
    return new Response(JSON.stringify({ success: true, draft, automation: automationResults }), {
      status: 200,
    });
  } catch (err: any) {
    // Håndter fejl samlet
    const status = typeof err?.status === "number" ? err.status : 500;
    const message = err?.message || "Ukendt fejl";
    console.error("gmail-create-draft-ai error:", message);
    return new Response(JSON.stringify({ error: message }), { status });
  }
});
