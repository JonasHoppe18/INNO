// supabase/functions/outlook-create-draft-ai/index.ts
import { createRemoteJWKSet, jwtVerify } from "https://deno.land/x/jose@v5.2.0/index.ts";
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
 * Outlook Create Draft AI
 * -----------------------
 * Edge function der:
 * - Henter en besked fra Microsoft Graph
 * - Indsamler kontekst (persona, automation, ordrer, produktdata)
 * - Kører OpenAI for at generere et udkast + eventuelle automation-actions
 * - Opretter et reply-draft i Outlook (Microsoft Graph) og returnerer metadata
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const EDGE_DEBUG_LOGS = Deno.env.get("EDGE_DEBUG_LOGS") === "true";
const emitDebugLog = (...args: Array<unknown>) => {
  if (EDGE_DEBUG_LOGS) {
    console.log(...args);
  }
};

// --- Env ---
const CLERK_JWT_ISSUER = Deno.env.get("CLERK_JWT_ISSUER");
const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MICROSOFT_CLIENT_ID = Deno.env.get("MICROSOFT_CLIENT_ID");
const MICROSOFT_CLIENT_SECRET = Deno.env.get("MICROSOFT_CLIENT_SECRET");
const MICROSOFT_TENANT_ID = Deno.env.get("MICROSOFT_TENANT_ID") ?? "common";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY");
const SHOPIFY_API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2024-07";
const INTERNAL_AGENT_SECRET = Deno.env.get("INTERNAL_AGENT_SECRET");
const OPENAI_EMBEDDING_MODEL = Deno.env.get("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";

if (!CLERK_JWT_ISSUER) console.warn("CLERK_JWT_ISSUER mangler (Supabase secret).");
if (!PROJECT_URL) console.warn("PROJECT_URL mangler – kan ikke kalde interne functions.");
if (!SERVICE_ROLE_KEY)
  console.warn("SERVICE_ROLE_KEY mangler – outlook-create-draft-ai kan ikke læse Supabase tabeller.");
if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET)
  console.warn("MICROSOFT_CLIENT_ID/SECRET mangler – outlook-create-draft-ai kan ikke forny tokens.");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY mangler – AI udkast vil kun bruge fallback.");
if (!Deno.env.get("OPENAI_MODEL")) console.warn("OPENAI_MODEL mangler – bruger default gpt-4o-mini.");
if (!ENCRYPTION_KEY)
  console.warn("ENCRYPTION_KEY mangler – direkte Shopify-opslag fra interne kald kan fejle.");
if (!INTERNAL_AGENT_SECRET)
  console.warn("INTERNAL_AGENT_SECRET mangler – interne automatiske kald er ikke sikret.");

const JWKS = CLERK_JWT_ISSUER
  ? createRemoteJWKSet(new URL(`${CLERK_JWT_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`))
  : null;
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

type GraphRecipient = {
  emailAddress?: {
    name?: string;
    address?: string;
  };
};

type GraphMessage = {
  id?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  conversationId?: string;
  internetMessageId?: string;
  sentDateTime?: string;
  receivedDateTime?: string;
};

// Læser Clerk bearer token fra Authorization-header
function getBearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw Object.assign(new Error("Missing Clerk session token"), { status: 401 });
  }
  return match[1];
}

// Tillader interne cron-kald via delt secret uden brugerens JWT
function isInternalAutomationRequest(req: Request): boolean {
  if (!INTERNAL_AGENT_SECRET) return false;
  const candidate =
    req.headers.get("x-internal-secret") ??
    req.headers.get("X-Internal-Secret") ??
    req.headers.get("x-automation-secret") ??
    req.headers.get("X-Automation-Secret");
  return candidate === INTERNAL_AGENT_SECRET;
}

// Safe JSON parsing af body
async function readJsonBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// Verificerer Clerk JWT og returnerer userId
async function requireUserIdFromJWT(req: Request): Promise<string> {
  if (!JWKS || !CLERK_JWT_ISSUER) {
    throw Object.assign(new Error("JWT verify ikke konfigureret (CLERK_JWT_ISSUER mangler)"), {
      status: 500,
    });
  }
  const token = getBearerToken(req);
  const { payload } = await jwtVerify(token, JWKS, { issuer: CLERK_JWT_ISSUER });
  const userId = payload?.sub;
  if (!userId || typeof userId !== "string") {
    throw Object.assign(new Error("Ugyldigt token: mangler user id"), { status: 401 });
  }
  return userId;
}

// Henter/fornyer Microsoft Graph access token via mail_accounts
async function getFreshOutlookAccessToken(userId: string): Promise<string> {
  if (!supabase) throw Object.assign(new Error("Supabase klient ikke konfigureret"), { status: 500 });
  const { data, error } = await supabase
    .from("mail_accounts")
    .select("access_token_enc, refresh_token_enc, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message), { status: 500 });
  }
  const accessToken = decodeToken((data as any)?.access_token_enc ?? null);
  const refreshToken = decodeToken((data as any)?.refresh_token_enc ?? null);
  if (!accessToken || !refreshToken) {
    throw Object.assign(new Error("Ingen Outlook credentials fundet for user."), { status: 404 });
  }

  const expiresAt =
    typeof (data as any)?.token_expires_at === "string"
      ? Date.parse((data as any).token_expires_at)
      : NaN;
  const expiresSoon = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 60_000;
  if (!expiresSoon) return accessToken;

  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    throw Object.assign(new Error("Microsoft OAuth config mangler til token refresh."), { status: 500 });
  }

  const params = new URLSearchParams();
  params.set("client_id", MICROSOFT_CLIENT_ID);
  params.set("client_secret", MICROSOFT_CLIENT_SECRET);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");
  params.set("scope", "offline_access Mail.ReadWrite User.Read");

  const res = await fetch(
    `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error_description || payload?.error || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Token refresh fejlede: ${message}`), { status: 502 });
  }
  const nextAccessToken = payload?.access_token;
  const nextRefreshToken = payload?.refresh_token;
  const expiresIn = Number(payload?.expires_in ?? 0);
  if (!nextAccessToken) {
    throw Object.assign(new Error("Token refresh mangler access_token"), { status: 502 });
  }
  const nextExpiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();

  const updatePayload: Record<string, unknown> = {
    access_token_enc: encodeToken(nextAccessToken),
    token_expires_at: nextExpiresAt,
  };
  if (nextRefreshToken) {
    updatePayload.refresh_token_enc = encodeToken(nextRefreshToken);
  }

  const { error: updateError } = await supabase
    .from("mail_accounts")
    .update(updatePayload)
    .eq("user_id", userId)
    .eq("provider", "outlook");
  if (updateError) {
    console.warn("outlook-create-draft-ai: failed to update tokens", updateError.message);
  }

  return nextAccessToken;
}

// Fjerner HTML og komprimerer whitespace
function stripHtml(input?: string | null): string {
  if (!input) return "";
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

// Genererer embeddings til produktmatch i Supabase
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

// Henter produktkontekst via Supabase vector search til brug i prompten
async function fetchProductContext(
  supabaseClient: ReturnType<typeof createClient> | null,
  shopRefId: string | null,
  text: string,
) {
  if (!supabaseClient || !shopRefId || !text?.trim()) return "";
  try {
    const embedding = await embedText(text.slice(0, 4000));
    const { data, error } = await supabaseClient.rpc("match_products", {
      query_embedding: embedding,
      match_threshold: 0.2,
      match_count: 5,
      filter_shop_id: shopRefId,
    });
    if (error || !Array.isArray(data) || !data.length) return "";
    return data
      .map((item: any) => {
        const price = item?.price ? `Price: ${item.price}.` : "";
        return `Product: ${item?.title ?? "Unknown"}. ${price} Details: ${item?.description ?? ""}`;
      })
      .join("\n");
  } catch (err) {
    console.warn("outlook-create-draft-ai: product context failed", err);
    return "";
  }
}

// Finder afsenderadresse (From/ReplyTo) fra Graph message
function resolveFromAddress(message?: GraphMessage): string {
  const addr =
    message?.from?.emailAddress?.address ||
    message?.replyTo?.[0]?.emailAddress?.address ||
    "";
  return addr || "";
}

// Henter fuld Graph-besked med relevante felter
async function fetchGraphMessage(messageId: string, accessToken: string): Promise<GraphMessage> {
  const url = new URL(`${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set(
    "$select",
    [
      "id",
      "subject",
      "bodyPreview",
      "body",
      "from",
      "toRecipients",
      "ccRecipients",
      "replyTo",
      "conversationId",
      "internetMessageId",
      "sentDateTime",
      "receivedDateTime",
    ].join(","),
  );
  url.searchParams.set("$expand", "attachments");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const message =
      (json && (json.error?.message || json.message)) || text || `HTTP ${res.status}`;
    throw Object.assign(
      new Error(`Microsoft Graph request failed (${res.status}): ${message}`),
      { status: res.status },
    );
  }

  return json as GraphMessage;
}

// Opretter reply draft i Outlook og patcher HTML-indholdet ind
async function createOutlookDraftReply({
  accessToken,
  messageId,
  bodyHtml,
}: {
  accessToken: string;
  messageId: string;
  bodyHtml: string;
}) {
  const replyRes = await fetch(`${GRAPH_BASE}/me/messages/${messageId}/createReply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const draftJson = await replyRes.json().catch(() => null);
  if (!replyRes.ok || !draftJson?.id) {
    throw new Error(
      `Kunne ikke oprette reply draft: ${
        draftJson?.error?.message || replyRes.status
      }`,
    );
  }

  const patchRes = await fetch(`${GRAPH_BASE}/me/messages/${draftJson.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      body: {
        contentType: "HTML",
        content: bodyHtml,
      },
      isDraft: true,
    }),
  });

  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(`Kunne ikke gemme reply draft: ${text || patchRes.status}`);
  }

  return draftJson;
}

// Kalder OpenAI med JSON schema og returnerer reply + actions
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
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI error ${res.status}`);
  const content = json?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    return { reply: null, actions: [] };
  }
  try {
    const parsed = JSON.parse(content);
    return { reply: parsed?.reply ?? null, actions: parsed?.actions ?? [] };
  } catch {
    return { reply: null, actions: [] };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await readJsonBody(req);
  const debug = body?.debug === true;
  const debugEnabled = debug || EDGE_DEBUG_LOGS;

  try {
    let supabaseUserId: string | null = null;

    if (isInternalAutomationRequest(req)) {
      supabaseUserId = typeof body?.userId === "string" ? body.userId : null;
      if (!supabaseUserId) {
        throw Object.assign(
          new Error("userId mangler i body for intern automation request"),
          { status: 400 },
        );
      }
    } else {
      const clerkUserId = await requireUserIdFromJWT(req);
      supabaseUserId = await resolveSupabaseUserId(supabase, clerkUserId);
    }

    const messageId = (body?.messageId ?? body?.id ?? "").trim();
    if (!messageId) {
      throw Object.assign(new Error("messageId mangler i body"), { status: 400 });
    }

    if (!supabaseUserId) {
      throw Object.assign(new Error("supabase user id mangler"), { status: 400 });
    }

    const accessToken = await getFreshOutlookAccessToken(supabaseUserId);
    const message = await fetchGraphMessage(messageId, accessToken);

    const fromAddress = resolveFromAddress(message);
    const subject = message?.subject ?? "";
    const textContent =
      message?.body?.contentType === "text"
        ? message?.body?.content ?? ""
        : stripHtml(message?.body?.content ?? "") || message?.bodyPreview || "";

    const classification = await classifyEmail({
      from: fromAddress,
      subject,
      body: textContent,
    });
    if (!classification.process) {
      emitDebugLog("outlook-create-draft-ai: gatekeeper skip", {
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

    const persona = await fetchPersona(supabase, supabaseUserId);
    const automation = await fetchAutomation(supabase, supabaseUserId);
    const policies = await fetchPolicies(supabase, supabaseUserId);

    const { orders, matchedSubjectNumber } = await resolveOrderContext({
      supabase,
      userId: supabaseUserId,
      email: fromAddress,
      subject,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });

    const orderSummary = buildOrderSummary(orders);
    const automationGuidance = buildAutomationGuidance(automation);

    const prompt = buildMailPrompt({
      emailBody: textContent || "(tomt indhold)",
      orderSummary,
      personaInstructions: persona.instructions,
      matchedSubjectNumber,
      extraContext:
        "Returner altid JSON hvor 'actions' beskriver konkrete handlinger du udfører i Shopify. Brug orderId (det numeriske id i parentes) når du udfylder actions. For payload: udfyld kun de felter der er nødvendige for handlingen. Hvis kunden beder om adresseændring, udfyld shipping_address med alle felter du kender (name, address1, address2, zip, city, country, phone). Ved edit_line_items skal du bruge line_item_id/variant_id fra KONTEKST. Hvis en handling ikke er tilladt i automationsreglerne, må du stadig returnere handlingen i actions; systemet markerer den til manuel approval i tråden.",
      signature: persona.signature,
      policies,
    });

    let aiText: string | null = null;
    let automationActions: AutomationAction[] = [];
    try {
      if (OPENAI_API_KEY) {
        const personaGuidance = `Sprogregel har altid forrang; ignorer persona-instruktioner om sprogvalg.
Persona instruktionsnoter: ${persona.instructions?.trim() || "Hold tonen venlig og effektiv."}
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
          "Hvis en handling udføres (f.eks. opdater adresse, annuller ordre, refund, hold, line item edit, opdater kontakt, resend invoice, tilføj note/tag), skal actions-listen indeholde et objekt med type, orderId og payload.",
          "Tilladte actions: update_shipping_address, cancel_order, refund_order, change_shipping_method, hold_or_release_fulfillment, edit_line_items, update_customer_contact, add_note, add_tag, add_internal_note_or_tag, resend_confirmation_or_invoice.",
          "For update_shipping_address skal payload.shipping_address mindst indeholde name, address1, city, zip/postal_code og country.",
          "For edit_line_items skal payload.operations bruges med type: set_quantity/remove_line_item/add_variant samt line_item_id/variant_id og quantity.",
          "Afslut ikke med signatur – signaturen tilføjes automatisk senere.",
        ].join("\n");
        const systemMsg = matchedSubjectNumber
          ? systemMsgBase +
            ` Hvis KONTEKST indeholder et ordrenummer (fx #${matchedSubjectNumber}), brug dette ordrenummer som reference i svaret og spørg IKKE efter ordrenummer igen.`
          : systemMsgBase;
        const { reply, actions } = await callOpenAI(prompt, systemMsg);
        aiText = reply;
        automationActions = actions ?? [];
      } else {
        aiText = null;
      }
    } catch (e) {
      console.warn("OpenAI fejl", String(e));
      aiText = null;
    }

    if (!aiText) {
      aiText = `Hej ${fromAddress?.split("@")?.[0] || "kunde"},\n\nTak for din besked. Jeg har kigget på din sag${
        orders.length ? ` og fandt ${orders.length} ordre(r) relateret til din e-mail.` : "."
      }\n\n${orderSummary}\nVi vender tilbage hurtigst muligt med en opdatering.`;
    }
    let finalText = aiText.trim();
    const signature = persona.signature?.trim();
    if (signature && signature.length && !finalText.includes(signature)) {
      finalText = stripTrailingSignoff(finalText);
      finalText = `${finalText}\n\n${signature}`;
    }

    const htmlBody = formatEmailBody(finalText);

    if (supabase && supabaseUserId && messageId) {
      const { error: updateError } = await supabase
        .from("mail_messages")
        .update({
          ai_draft_text: finalText,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", supabaseUserId)
        .eq("provider", "outlook")
        .eq("provider_message_id", messageId);
      if (updateError) {
        console.warn("outlook-create-draft-ai: failed to store ai draft", updateError.message);
      }
    }

    const draft = await createOutlookDraftReply({
      accessToken,
      messageId,
      bodyHtml: htmlBody,
    });
    const draftInsertPromise = (async () => {
      if (!supabase || !supabaseUserId) return;
      const shopId = await resolveShopId(supabase, { ownerUserId: supabaseUserId });
      if (!shopId) {
        console.warn("outlook-create-draft-ai: no shop id found, skipping draft log");
        return;
      }
      const { error } = await supabase.from("drafts").insert({
        shop_id: shopId,
        customer_email: fromAddress || "",
        subject,
        platform: "outlook",
        status: "pending",
        draft_id: draft?.id ?? null,
        message_id: draft?.id ?? null,
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.warn("outlook-create-draft-ai: failed to log draft", error.message);
      }
    })();

    const automationResults = await executeAutomationActions({
      supabase,
      supabaseUserId,
      actions: automationActions,
      automation,
      tokenSecret: ENCRYPTION_KEY,
      apiVersion: SHOPIFY_API_VERSION,
    });
    if (debugEnabled) {
      emitDebugLog(
        "outlook-create-draft-ai: automation results",
        JSON.stringify(automationResults),
      );
    }

    if (debugEnabled) {
      emitDebugLog(
        JSON.stringify(
          {
            subject,
            from: fromAddress,
            orders: orders?.length ?? 0,
            matchedSubjectNumber,
            draftId: draft?.id,
          },
          null,
          2,
        ),
      );
    }

    await draftInsertPromise;

    return new Response(
      JSON.stringify({
        success: true,
        draftId: draft?.id,
        reply: finalText,
        conversationId: message?.conversationId,
        automation: automationResults,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    const status = (error as any)?.status ?? 500;
    const message = (error as any)?.message ?? "Ukendt fejl";
    console.error("outlook-create-draft-ai failed:", message);
    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
});
