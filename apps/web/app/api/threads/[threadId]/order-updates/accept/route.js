import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { decryptString } from "@/lib/server/shopify-oauth";
import { sendPostmarkEmail } from "@/lib/server/postmark";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-07";
const POSTMARK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const POSTMARK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeDomain(input = "") {
  return String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function buildWebshipperApiBase(tenant = "") {
  const raw = String(tenant || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!raw) return null;
  const withoutApiSuffix = raw.replace(/\.api\.webshipper\.io$/i, "");
  const host = withoutApiSuffix.endsWith(".webshipper.io")
    ? withoutApiSuffix.replace(/\.webshipper\.io$/i, ".api.webshipper.io")
    : `${withoutApiSuffix}.api.webshipper.io`;
  return `https://${host}/v2`;
}

function webshipperHeaders(token = "") {
  return {
    Authorization: `Bearer ${String(token || "").trim()}`,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
}

function decodeByteaToText(value) {
  if (!value) return null;
  if (typeof value === "string") {
    if (!value.startsWith("\\x")) return value;
    const hex = value.slice(2);
    if (!hex) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
    }
    return new TextDecoder().decode(bytes);
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return null;
}

async function parseWebshipperError(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    const detail =
      (typeof first?.detail === "string" && first.detail) ||
      (typeof first?.title === "string" && first.title) ||
      raw;
    return `HTTP ${response.status}: ${detail}`;
  } catch {
    return `HTTP ${response.status}: ${raw}`;
  }
}

async function resolveWebshipperOrderId({ baseUrl, token, orderRef }) {
  const rawRef = String(orderRef || "").trim();
  if (!rawRef) return null;
  const plainRef = rawRef.replace(/^#+/, "");
  const candidates = Array.from(new Set([rawRef, plainRef, `#${plainRef}`, `##${plainRef}`])).filter(Boolean);

  for (const ref of candidates) {
    const url = new URL(`${baseUrl}/orders`);
    url.searchParams.set("filter[visible_ref]", ref);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: webshipperHeaders(token),
    });
    if (!response.ok) {
      const detail = await parseWebshipperError(response);
      throw new Error(`Webshipper order lookup failed. ${detail}`);
    }
    const payload = await response.json().catch(() => null);
    const found = payload?.data?.[0]?.id ? String(payload.data[0].id) : null;
    if (found) return found;
  }

  return null;
}

async function syncWebshipperAction({
  serviceClient,
  scope,
  actionType,
  shopifyOrder,
  payload,
}) {
  if (!serviceClient || !shopifyOrder || !actionType) {
    return { ok: false, reason: "Missing context for Webshipper sync." };
  }

  let query = serviceClient
    .from("integrations")
    .select("config, credentials_enc, is_active")
    .eq("provider", "webshipper")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "user_id",
  });
  const { data: integration, error: integrationError } = await query.maybeSingle();
  if (integrationError || !integration?.credentials_enc) {
    return { ok: false, reason: "Webshipper integration not found or inactive." };
  }

  const encodedToken = decodeByteaToText(integration.credentials_enc);
  if (!encodedToken) {
    return { ok: false, reason: "Webshipper token is missing or invalid." };
  }

  let token = "";
  try {
    token = decryptString(encodedToken);
  } catch (error) {
    // Legacy fallback: allow plain-text token rows while migrating.
    token = encodedToken;
  }

  const tenant = integration?.config?.tenant || "";
  const baseUrl = buildWebshipperApiBase(tenant);
  if (!baseUrl) {
    return { ok: false, reason: "Webshipper tenant is missing." };
  }

  const orderRef =
    (typeof shopifyOrder?.name === "string" && shopifyOrder.name.trim()) ||
    (shopifyOrder?.order_number ? `#${shopifyOrder.order_number}` : String(shopifyOrder?.id || ""));
  if (!orderRef) {
    return { ok: false, reason: "Shopify order reference missing." };
  }

  const orderId = await resolveWebshipperOrderId({
    baseUrl,
    token,
    orderRef,
  });
  if (!orderId) {
    return { ok: false, reason: `Order ${orderRef} not found in Webshipper.` };
  }

  const normalizedAction = String(actionType || "").trim().toLowerCase();

  if (normalizedAction === "update_shipping_address") {
    const shippingAddress =
      payload?.shipping_address && typeof payload.shipping_address === "object"
        ? payload.shipping_address
        : payload?.shippingAddress && typeof payload.shippingAddress === "object"
        ? payload.shippingAddress
        : null;
    if (!shippingAddress) {
      return { ok: false, reason: "Missing shipping address payload for Webshipper sync." };
    }

    const countryCode = normalizeCountryCode(shippingAddress.country_code || shippingAddress.country || "DK");
    const patchBody = {
      data: {
        id: String(orderId),
        type: "orders",
        attributes: {
          delivery_address: {
            att_contact: asString(shippingAddress.name),
            address_1: asString(shippingAddress.address1),
            address_2: asString(shippingAddress.address2) || null,
            zip: asString(shippingAddress.zip || shippingAddress.postal_code),
            city: asString(shippingAddress.city),
            country_code: countryCode,
            email: asString(shippingAddress.email) || null,
            phone: asString(shippingAddress.phone) || null,
          },
        },
      },
    };

    const response = await fetch(`${baseUrl}/orders/${orderId}`, {
      method: "PATCH",
      headers: webshipperHeaders(token),
      body: JSON.stringify(patchBody),
    });
    if (!response.ok) {
      const detail = await parseWebshipperError(response);
      return { ok: false, reason: `Webshipper address update failed. ${detail}` };
    }

    return { ok: true, orderId: String(orderId), orderRef: String(orderRef), action: normalizedAction };
  }

  if (normalizedAction === "cancel_order") {
    const statusCandidates = ["cancelled", "canceled"];
    let lastError = "";
    for (const status of statusCandidates) {
      const patchBody = {
        data: {
          id: String(orderId),
          type: "orders",
          attributes: { status },
        },
      };
      const response = await fetch(`${baseUrl}/orders/${orderId}`, {
        method: "PATCH",
        headers: webshipperHeaders(token),
        body: JSON.stringify(patchBody),
      });
      if (response.ok) {
        return { ok: true, orderId: String(orderId), orderRef: String(orderRef), action: normalizedAction };
      }
      lastError = await parseWebshipperError(response);
    }
    return { ok: false, reason: `Webshipper cancel failed. ${lastError}` };
  }

  return {
    ok: false,
    skipped: true,
    reason: `No Webshipper sync mapping for action "${normalizedAction}".`,
  };
}

function extractOrderNumber(value = "") {
  const text = String(value || "");
  const explicitMatch = text.match(
    /\b(?:ordre|order)\s*(?:nr\.?|number)?\s*#?\s*(\d{3,})\b/i
  );
  if (explicitMatch?.[1]) return explicitMatch[1];
  const hashMatch = text.match(/#\s*(\d{3,})\b/);
  return hashMatch?.[1] || null;
}

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const normalizeRegionLookupToken = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
const COUNTRY_NAME_TO_ISO2 = (() => {
  const map = new Map();
  const locales = ["en", "da", "sv", "no", "de", "fr", "es", "it", "nl", "pt", "pl"];
  const regionCodes = [];
  for (let i = 65; i <= 90; i += 1) {
    for (let j = 65; j <= 90; j += 1) {
      regionCodes.push(String.fromCharCode(i, j));
    }
  }
  for (const code of regionCodes) {
    map.set(code, code);
    for (const locale of locales) {
      try {
        const display = new Intl.DisplayNames([locale], { type: "region" });
        const label = display.of(code);
        if (label && label !== code) {
          map.set(normalizeRegionLookupToken(label), code);
        }
      } catch {
        // Ignore locale issues and continue.
      }
    }
  }
  return map;
})();
const normalizeCountryCode = (value) => {
  const raw = asString(value);
  if (!raw) return "DK";
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const token = normalizeRegionLookupToken(raw);
  return COUNTRY_NAME_TO_ISO2.get(token) || "DK";
};
const asNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

function extractAddressText(value = "") {
  const cleaned = String(value || "").trim();
  if (!cleaned) return "";
  return cleaned
    .replace(/^updated shipping address to\s*/i, "")
    .replace(/^update shipping address to\s*/i, "")
    .replace(/^updated address to\s*/i, "")
    .trim();
}

function parseAddressFromText(value = "") {
  const addressText = extractAddressText(value);
  if (!addressText) return null;

  const segments = addressText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return null;

  let name = null;
  let country = null;
  let zip = null;
  let city = null;
  let address1 = null;
  let address2 = null;

  const zipCityRegex = /^([a-z]{0,3}-?\d{3,10})\s+(.+)$/i;
  const working = [...segments];

  const first = working[0] || "";
  if (first && !/\d/.test(first) && working.length > 1) {
    name = first;
    working.shift();
  }

  const last = working[working.length - 1] || "";
  if (last && !/\d/.test(last) && working.length > 1) {
    country = last;
    working.pop();
  }

  for (let idx = 0; idx < working.length; idx += 1) {
    const segment = working[idx];
    const zipCityMatch = segment.match(zipCityRegex);
    if (!zipCityMatch) continue;
    zip = zipCityMatch[1].trim();
    city = zipCityMatch[2].trim();
    working.splice(idx, 1);
    break;
  }

  address1 = working[0] || null;
  address2 = working[1] || null;

  if (!name && !address1 && !zip && !city && !country) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(address1 ? { address1 } : {}),
    ...(address2 ? { address2 } : {}),
    ...(zip ? { zip } : {}),
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
  };
}

function parseLogDetail(raw = "") {
  const text = String(raw || "").trim();
  if (!text) {
    return {
      detailText: "",
      orderId: null,
      orderNumber: null,
      actionType: null,
      payload: {},
    };
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      const detailText =
        typeof parsed?.detail === "string"
          ? parsed.detail
          : typeof parsed?.message === "string"
          ? parsed.message
          : typeof parsed?.summary === "string"
          ? parsed.summary
          : typeof parsed?.text === "string"
          ? parsed.text
          : typeof parsed?.action === "string"
          ? parsed.action
          : "";
      const orderIdCandidate = parsed?.orderId ?? parsed?.order_id ?? parsed?.adminId ?? null;
      const normalizedOrderId =
        typeof orderIdCandidate === "number"
          ? String(orderIdCandidate)
          : typeof orderIdCandidate === "string"
          ? orderIdCandidate.trim()
          : null;
      const orderNumberCandidate =
        parsed?.orderNumber ?? parsed?.order_number ?? parsed?.orderNo ?? null;
      const normalizedOrderNumber =
        typeof orderNumberCandidate === "number"
          ? String(orderNumberCandidate)
          : typeof orderNumberCandidate === "string"
          ? orderNumberCandidate.trim()
          : null;
      const actionTypeCandidate =
        typeof parsed?.actionType === "string"
          ? parsed.actionType
          : typeof parsed?.action === "string"
          ? parsed.action
          : null;
      return {
        detailText,
        orderId: normalizedOrderId || null,
        orderNumber: normalizedOrderNumber || extractOrderNumber(detailText),
        actionType: actionTypeCandidate ? actionTypeCandidate.trim() : null,
        payload:
          parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {},
      };
    } catch {
      return {
        detailText: text,
        orderId: null,
        orderNumber: extractOrderNumber(text),
        actionType: null,
        payload: {},
      };
    }
  }

  return {
    detailText: text,
    orderId: null,
    orderNumber: extractOrderNumber(text),
    actionType: null,
    payload: {},
  };
}

function normalizeActionStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "approved_test_mode") return "applied";
  if (status === "applied" || status === "approved") return "applied";
  if (status === "declined" || status === "denied") return "declined";
  if (status === "failed" || status === "error") return "failed";
  return "pending";
}

async function loadWorkspaceTestSettings(serviceClient, workspaceId) {
  if (!workspaceId) {
    return { testMode: false, testEmail: null };
  }
  const { data, error } = await serviceClient
    .from("workspaces")
    .select("test_mode, test_email")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const testEmail = asString(data?.test_email).toLowerCase();
  return {
    testMode: Boolean(data?.test_mode),
    testEmail: testEmail || null,
  };
}

async function loadForwardingContext(serviceClient, scope, thread, payload) {
  const messageId = asString(payload?.original_message_id || payload?.message_id || "");
  let messageQuery = serviceClient
    .from("mail_messages")
    .select("id, subject, body_text, body_html, from_name, from_email, provider_message_id")
    .eq("thread_id", thread.id)
    .eq("from_me", false)
    .order("received_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (messageId) {
    messageQuery = serviceClient
      .from("mail_messages")
      .select("id, subject, body_text, body_html, from_name, from_email, provider_message_id")
      .eq("id", messageId)
      .limit(1);
  }
  messageQuery = applyScope(messageQuery, scope);
  const { data: inboundMessage } = await messageQuery.maybeSingle();

  let mailboxQuery = serviceClient
    .from("mail_accounts")
    .select("id, provider_email, from_email, from_name")
    .eq("id", thread.mailbox_id)
    .limit(1);
  mailboxQuery = applyScope(mailboxQuery, scope);
  const { data: mailbox } = await mailboxQuery.maybeSingle();

  const sourceSubject = asString(inboundMessage?.subject || thread.subject || "Inbound message");
  const sourceBody = asString(inboundMessage?.body_text || inboundMessage?.body_html || "");
  const sourceFromName = asString(inboundMessage?.from_name || "");
  const sourceFromEmail = asString(inboundMessage?.from_email || "");
  const sourceFrom = sourceFromEmail
    ? sourceFromName
      ? `${sourceFromName} <${sourceFromEmail}>`
      : sourceFromEmail
    : "Unknown sender";

  const fromEmail =
    asString(mailbox?.from_email || "").toLowerCase() ||
    asString(mailbox?.provider_email || "").toLowerCase() ||
    POSTMARK_FROM_EMAIL;
  const fromName = asString(mailbox?.from_name || "") || POSTMARK_FROM_NAME;
  return {
    sourceSubject,
    sourceBody,
    sourceFrom,
    fromEmail,
    fromName,
    providerMessageId: asString(inboundMessage?.provider_message_id || ""),
  };
}

function buildForwardBodies(context) {
  const textBody = [
    "Forwarded inbound email",
    "",
    `From: ${context.sourceFrom || "Unknown sender"}`,
    `Subject: ${context.sourceSubject || "(no subject)"}`,
    "",
    context.sourceBody || "(empty body)",
  ].join("\n");
  const safeBody = String(context.sourceBody || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");
  const htmlBody =
    `<p><strong>Forwarded inbound email</strong></p>` +
    `<p><strong>From:</strong> ${context.sourceFrom || "Unknown sender"}<br/>` +
    `<strong>Subject:</strong> ${context.sourceSubject || "(no subject)"}</p>` +
    `<hr/><p style=\"white-space:pre-wrap\">${safeBody}</p>`;
  return { textBody, htmlBody };
}

async function loadLatestInboundMessage(serviceClient, scope, threadId) {
  let query = serviceClient
    .from("mail_messages")
    .select("id, subject, body_text, body_html, from_name, from_email, provider_message_id")
    .eq("thread_id", threadId)
    .eq("from_me", false)
    .order("received_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  query = applyScope(query, scope);
  const { data } = await query.maybeSingle();
  return data || null;
}

async function loadMailboxSender(serviceClient, scope, mailboxId) {
  if (!mailboxId) {
    return {
      fromEmail: POSTMARK_FROM_EMAIL,
      fromName: POSTMARK_FROM_NAME,
    };
  }
  let query = serviceClient
    .from("mail_accounts")
    .select("id, provider_email, from_email, from_name")
    .eq("id", mailboxId)
    .limit(1);
  query = applyScope(query, scope);
  const { data } = await query.maybeSingle();
  const fromEmail =
    asString(data?.from_email || "").toLowerCase() ||
    asString(data?.provider_email || "").toLowerCase() ||
    POSTMARK_FROM_EMAIL;
  const fromName = asString(data?.from_name || "") || POSTMARK_FROM_NAME;
  return { fromEmail, fromName };
}

function buildReturnInstructionsBody({
  customerName = "",
  returnWindowDays = 30,
  returnAddress = "",
  requireUnused = true,
  requireOriginalPackaging = true,
  returnShippingMode = "customer_paid",
}) {
  const normalizedName = String(customerName || "").trim();
  const greeting = normalizedName ? `Hi ${normalizedName},` : "Hi,";
  const requirementParts = [];
  if (requireUnused) requirementParts.push("unused");
  if (requireOriginalPackaging) requirementParts.push("in its original packaging");
  const requirementLine = requirementParts.length
    ? `as long as the item is ${requirementParts.join(" and ")}`
    : "according to our return requirements";
  const shippingLine =
    returnShippingMode === "customer_paid"
      ? "Please note that return shipping costs are paid by the customer."
      : "Return shipping is handled according to your store return settings.";
  return [
    greeting,
    "",
    `You can return your order within ${returnWindowDays} days of receiving it ${requirementLine}.`,
    "",
    "Please send the return to:",
    returnAddress || "Return address is currently not configured. Reply here and we will provide it.",
    "",
    shippingLine,
  ].join("\n");
}

async function upsertReturnCase({
  serviceClient,
  workspaceId,
  threadId,
  payload = {},
  status = "requested",
  isEligible = null,
  eligibilityReason = null,
}) {
  if (!workspaceId || !threadId) return null;
  const nowIso = new Date().toISOString();
  let lookup = serviceClient
    .from("return_cases")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("thread_id", threadId)
    .order("updated_at", { ascending: false })
    .limit(1);
  const { data: existing } = await lookup.maybeSingle();

  const upsertPayload = {
    workspace_id: workspaceId,
    thread_id: threadId,
    shopify_order_id: asString(payload?.shopify_order_id || payload?.order_id || ""),
    customer_email: asString(payload?.customer_email || ""),
    reason: asString(payload?.reason || payload?.return_reason || ""),
    status,
    return_shipping_mode: asString(payload?.return_shipping_mode || "customer_paid") || "customer_paid",
    is_eligible: typeof isEligible === "boolean" ? isEligible : null,
    eligibility_reason: asString(eligibilityReason || payload?.eligibility?.reason || "") || null,
    updated_at: nowIso,
  };
  if (existing?.id) {
    const { data } = await serviceClient
      .from("return_cases")
      .update(upsertPayload)
      .eq("id", existing.id)
      .select(
        "id, status, is_eligible, eligibility_reason, return_shipping_mode, reason, shopify_order_id, customer_email, created_at, updated_at",
      )
      .maybeSingle();
    return data || null;
  }
  const { data } = await serviceClient
    .from("return_cases")
    .insert({
      ...upsertPayload,
      created_at: nowIso,
    })
    .select(
      "id, status, is_eligible, eligibility_reason, return_shipping_mode, reason, shopify_order_id, customer_email, created_at, updated_at",
    )
    .maybeSingle();
  return data || null;
}

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

function buildActionKey(actionType, orderId, payload = {}) {
  return `${String(actionType || "").trim().toLowerCase()}::${String(
    orderId || ""
  ).trim()}::${stableStringify(payload || {})}`;
}

function isOrderMutationBlocked(order = {}, actionType = "") {
  const type = String(actionType || "").trim().toLowerCase();
  if (
    type !== "update_shipping_address" &&
    type !== "cancel_order" &&
    type !== "create_exchange_request"
  ) {
    return null;
  }

  if (order?.cancelled_at) {
    return "Order is canceled and cannot be changed";
  }

  if (order?.closed_at && type !== "create_exchange_request") {
    return "Order is closed and cannot be changed";
  }

  if (type !== "create_exchange_request") {
    const fulfillmentStatus = String(order?.fulfillment_status || "").trim().toLowerCase();
    const hasFulfillmentRecords = Array.isArray(order?.fulfillments) && order.fulfillments.length > 0;
    const shippedLikeStatus = new Set(["fulfilled", "partial", "partially_fulfilled"]);
    if (shippedLikeStatus.has(fulfillmentStatus) || hasFulfillmentRecords) {
      return "Order is Fulfilled and cannot be changed";
    }
  }

  return null;
}

function buildBlockedActionDetail(actionType = "", blockedReason = "") {
  return String(blockedReason || "Order is Fulfilled and cannot be changed").trim();
}

async function generateBlockedActionDraft({
  actionType,
  blockedReason,
  customerFirstName,
  customerMessage,
  orderName,
}) {
  const customerName = (customerFirstName || "there").trim() || "there";
  const orderRef = String(orderName || "").trim();
  const isDanish = /[æøå]|\b(hej|ordren|adresse|ændre|kan|ikke|venlig|hilsen)\b/i.test(
    String(customerMessage || "")
  );
  const reasonLower = String(blockedReason || "").toLowerCase();

  // Deterministic fallback for canceled orders so we never hallucinate shipment/tracking details.
  if (reasonLower.includes("canceled") || reasonLower.includes("cancelled")) {
    const blockedActionLineDa =
      actionType === "cancel_order"
        ? "Ordren er allerede annulleret."
        : "Ordren er annulleret, så vi kan desværre ikke ændre leveringsadressen.";
    const blockedActionLineEn =
      actionType === "cancel_order"
        ? "This order is already canceled."
        : "This order is canceled, so we unfortunately cannot update the shipping address.";
    if (isDanish) {
      return [
        `Hej ${customerName},`,
        "",
        orderRef ? `${orderRef}: ${blockedActionLineDa}` : blockedActionLineDa,
        "",
        actionType === "cancel_order"
          ? "Hvis du har andre spørgsmål til ordren, hjælper vi gerne."
          : "Hvis du stadig ønsker varen, kan du lægge en ny ordre.",
        "",
        "God dag.",
      ].join("\n");
    }
    return [
      `Hi ${customerName},`,
      "",
      orderRef ? `${orderRef}: ${blockedActionLineEn}` : blockedActionLineEn,
      "",
      actionType === "cancel_order"
        ? "If you have any other questions about the order, we are happy to help."
        : "If you still want the item, please place a new order.",
      "",
      "Have a great day.",
    ].join("\n");
  }

  if (!OPENAI_API_KEY) return null;

  const systemPrompt = [
    "You are Sona, a customer support agent.",
    "Write a short, empathetic email reply in the same language as the customer message.",
    "The requested operation was NOT completed. State this clearly.",
    "Do not invent actions and do not claim any update/cancellation was completed.",
    "Never write phrases equivalent to 'I have updated' or 'I have cancelled' in this context.",
    "Never mention tracking number, tracking link, or shipment status unless explicitly provided in the prompt.",
    "Do not include any signature. Signature is added later by the app.",
  ].join(" ");

  const userPrompt = [
    `Action type: ${actionType}`,
    `Blocked reason: ${blockedReason}`,
    orderName ? `Order reference: ${orderName}` : "",
    `Customer first name: ${customerName}`,
    "Customer message:",
    customerMessage || "(empty)",
    "Write only the reply body text.",
    "Important: Explain that this request could not be completed.",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message || `OpenAI returned ${response.status} while generating blocked draft.`;
    throw new Error(message);
  }
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();
  return text || null;
}

function draftImpliesCompletedAction(text = "", actionType = "") {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return false;
  if (actionType === "update_shipping_address") {
    return (
      normalized.includes("har opdateret leveringsadressen") ||
      normalized.includes("har opdateret adressen") ||
      normalized.includes("i have updated the shipping address") ||
      normalized.includes("i have updated the address")
    );
  }
  if (actionType === "cancel_order") {
    return (
      normalized.includes("har annulleret ordren") ||
      normalized.includes("i have cancelled the order")
    );
  }
  return false;
}

async function upsertThreadDraft({
  serviceClient,
  scope,
  thread,
  bodyText,
  subject,
}) {
  const nowIso = new Date().toISOString();
  const snippet = String(bodyText || "").replace(/\s+/g, " ").trim().slice(0, 240);

  const { data: existingDraft } = await applyScope(
    serviceClient
      .from("mail_messages")
      .select("id")
      .eq("thread_id", thread.id)
      .eq("from_me", true)
      .eq("is_draft", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    scope
  );

  if (existingDraft?.id) {
    const { data, error } = await applyScope(
      serviceClient
        .from("mail_messages")
        .update({
          subject,
          snippet,
          body_text: bodyText,
          body_html: null,
          ai_draft_text: bodyText,
          updated_at: nowIso,
        })
        .eq("id", existingDraft.id)
        .eq("thread_id", thread.id)
        .select("id")
        .maybeSingle(),
      scope
    );
    if (error) throw new Error(error.message);
    return data?.id || existingDraft.id;
  }

  const { data, error } = await applyScope(
    serviceClient
      .from("mail_messages")
      .insert({
        user_id: thread.user_id,
        workspace_id: thread.workspace_id || null,
        mailbox_id: thread.mailbox_id || null,
        thread_id: thread.id,
        provider: thread.provider || "smtp",
        provider_message_id: `draft-${thread.id}-${Date.now()}`,
        subject,
        snippet,
        body_text: bodyText,
        body_html: null,
        from_me: true,
        is_draft: true,
        ai_draft_text: bodyText,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id")
      .maybeSingle(),
    scope
  );
  if (error) throw new Error(error.message);
  return data?.id || null;
}

function matchesOrderNumber(order = {}, orderNumber = "") {
  const candidate = String(orderNumber || "").replace(/\D/g, "");
  if (!candidate) return false;
  const orderNum = String(order?.order_number ?? "").replace(/\D/g, "");
  if (orderNum && orderNum === candidate) return true;
  const name = String(order?.name || "");
  if (new RegExp(`#\\s*${candidate}(?:\\b|\\D)`, "i").test(name)) return true;
  const nameDigits = name.replace(/\D/g, "");
  return Boolean(nameDigits) && nameDigits === candidate;
}

async function shopifyRequest({ domain, token, path, method = "GET", body }) {
  const response = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }
  );
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function shopifyGraphql({ domain, token, query, variables = {} }) {
  const result = await shopifyRequest({
    domain,
    token,
    path: `/graphql.json`,
    method: "POST",
    body: { query, variables },
  });
  const errors = Array.isArray(result?.payload?.errors) ? result.payload.errors : [];
  if (errors.length) {
    const message = errors
      .map((item) => item?.message || "GraphQL error")
      .filter(Boolean)
      .join("; ");
    throw Object.assign(new Error(message || "Shopify GraphQL failed."), { status: 400 });
  }
  if (!result?.payload?.data) {
    throw Object.assign(new Error("Shopify GraphQL returned no data."), { status: 400 });
  }
  return result.payload.data;
}

const toShopifyGid = (type, value) => {
  if (typeof value === "string" && value.startsWith("gid://")) return value;
  const numeric = asNumber(value);
  if (!numeric) return "";
  return `gid://shopify/${type}/${Math.trunc(numeric)}`;
};

const toShopifyReturnGid = (value) => {
  const direct = asString(value);
  if (direct.startsWith("gid://shopify/Return/")) return direct;
  return toShopifyGid("Return", value);
};

function parseLineItemOperations(payload = {}) {
  const opsRaw = Array.isArray(payload?.operations) ? payload.operations : [];
  const ops = opsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const type = asString(item.type).toLowerCase();
      if (!type) return null;
      const quantity = asNumber(item.quantity ?? item.qty);
      const lineItemId = toShopifyGid(
        "LineItem",
        item.lineItemId ?? item.line_item_id ?? item.id
      );
      const variantId = toShopifyGid(
        "ProductVariant",
        item.variantId ?? item.variant_id
      );
      if (type === "set_quantity" || type === "remove_line_item") {
        if (!lineItemId) return null;
        return {
          type,
          lineItemId,
          quantity: type === "remove_line_item" ? 0 : Math.max(0, Math.trunc(quantity ?? 0)),
        };
      }
      if (type === "add_variant") {
        if (!variantId) return null;
        return {
          type,
          variantId,
          quantity: Math.max(1, Math.trunc(quantity ?? 1)),
        };
      }
      return null;
    })
    .filter(Boolean);

  if (ops.length) return ops;

  const legacyLineItemId = toShopifyGid(
    "LineItem",
    payload?.lineItemId ?? payload?.line_item_id ?? payload?.id
  );
  const legacyVariantId = toShopifyGid(
    "ProductVariant",
    payload?.variantId ?? payload?.variant_id
  );
  const legacyQuantity = Math.max(0, Math.trunc(asNumber(payload?.quantity ?? payload?.qty) ?? 0));
  const mode = asString(payload?.mode ?? payload?.operation).toLowerCase();
  if (legacyVariantId) {
    return [
      {
        type: "add_variant",
        variantId: legacyVariantId,
        quantity: Math.max(1, legacyQuantity || 1),
      },
    ];
  }
  if (legacyLineItemId && mode === "remove") {
    return [{ type: "remove_line_item", lineItemId: legacyLineItemId, quantity: 0 }];
  }
  if (legacyLineItemId && legacyQuantity >= 0) {
    return [{ type: "set_quantity", lineItemId: legacyLineItemId, quantity: legacyQuantity }];
  }
  return [];
}

function assertMutationUserErrors(scope, fallback = "Shopify mutation failed.") {
  const userErrors = Array.isArray(scope?.userErrors) ? scope.userErrors : [];
  if (!userErrors.length) return;
  const message = userErrors
    .map((item) => item?.message || "")
    .filter(Boolean)
    .join("; ");
  throw Object.assign(new Error(message || fallback), { status: 400 });
}

function normalizeExchangePayload(payload = {}) {
  const ALLOWED_RETURN_REASONS = new Set([
    "COLOR",
    "DEFECTIVE",
    "NOT_AS_DESCRIBED",
    "OTHER",
    "SIZE_TOO_LARGE",
    "SIZE_TOO_SMALL",
    "STYLE",
    "UNKNOWN",
    "UNWANTED",
    "WRONG_ITEM",
  ]);
  const normalizeReturnReasonToken = (value = "") => {
    const token = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
    return ALLOWED_RETURN_REASONS.has(token) ? token : "";
  };
  const inferReturnReasonFromText = (value = "") => {
    const text = String(value || "").toLowerCase();
    if (!text) return "UNKNOWN";
    if (
      /\b(defekt|ødelagt|skadet|broken|defective|damaged|faulty)\b/.test(text)
    ) {
      return "DEFECTIVE";
    }
    if (
      /\b(forkert vare|forkert produkt|mangler|missing|only one|kun en|kun 1|wrong item)\b/.test(
        text
      )
    ) {
      return "WRONG_ITEM";
    }
    if (/\b(not as described|ikke som beskrevet)\b/.test(text)) {
      return "NOT_AS_DESCRIBED";
    }
    if (/\b(fortrudt|changed my mind|unwanted)\b/.test(text)) {
      return "UNWANTED";
    }
    if (/\b(too small|for lille|size too small)\b/.test(text)) {
      return "SIZE_TOO_SMALL";
    }
    if (/\b(too large|for stor|size too large)\b/.test(text)) {
      return "SIZE_TOO_LARGE";
    }
    return "UNKNOWN";
  };

  const returnLineItemId = toShopifyGid(
    "LineItem",
    payload?.return_line_item_id ?? payload?.returnLineItemId ?? payload?.line_item_id ?? payload?.lineItemId
  );
  const returnFulfillmentLineItemId = toShopifyGid(
    "FulfillmentLineItem",
    payload?.return_fulfillment_line_item_id ??
      payload?.returnFulfillmentLineItemId ??
      payload?.fulfillment_line_item_id ??
      payload?.fulfillmentLineItemId
  );
  const exchangeVariantId = toShopifyGid(
    "ProductVariant",
    payload?.exchange_variant_id ?? payload?.exchangeVariantId ?? payload?.variant_id ?? payload?.variantId
  );
  const returnQuantity = Math.max(
    1,
    Math.trunc(asNumber(payload?.return_quantity ?? payload?.returnQuantity ?? payload?.quantity) ?? 1)
  );
  const exchangeQuantity = Math.max(
    1,
    Math.trunc(asNumber(payload?.exchange_quantity ?? payload?.exchangeQuantity ?? payload?.quantity) ?? 1)
  );
  const rawReason =
    asString(payload?.return_reason) ||
    asString(payload?.reason) ||
    asString(payload?.reason_notes) ||
    asString(payload?.requested_changes) ||
    asString(payload?.reason_code) ||
    "";
  const normalizedReason = normalizeReturnReasonToken(rawReason);
  const returnReason = normalizedReason || inferReturnReasonFromText(rawReason);
  const returnReasonNote =
    rawReason && !normalizedReason && returnReason !== "UNKNOWN" ? rawReason : "";
  return {
    returnLineItemId,
    returnFulfillmentLineItemId,
    exchangeVariantId,
    returnQuantity,
    exchangeQuantity,
    returnReason,
    returnReasonNote,
  };
}

function inferRestockRecommendation({ payload = {}, detailText = "" }) {
  const reasonToken = String(
    payload?.return_reason ||
      payload?.returnReason ||
      payload?.reason_code ||
      payload?.reason ||
      ""
  )
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const text = String(detailText || "").toLowerCase();
  const combined = `${reasonToken} ${text}`.trim();

  const notRestockSignals = [
    "DEFECTIVE",
    "DAMAGED",
    "BROKEN",
    "FAULTY",
    "NOT_AS_DESCRIBED",
    "MISSING_PARTS",
    "HYGIENE",
  ];
  const restockSignals = [
    "WRONG_ITEM",
    "SIZE_TOO_SMALL",
    "SIZE_TOO_LARGE",
    "UNWANTED",
    "STYLE",
    "COLOR",
  ];
  const containsAny = (signals) =>
    signals.some((signal) => combined.includes(String(signal).toLowerCase()));

  if (
    containsAny(notRestockSignals) ||
    /\b(defekt|ødelagt|skadet|broken|defective|damaged|faulty|hygiejne)\b/.test(text)
  ) {
    return {
      restock: false,
      confidence: "high",
      reason: "AI vurderer at varen ikke bør restockes pga. fejl/skade/hygiejne.",
    };
  }
  if (
    containsAny(restockSignals) ||
    /\b(forkert vare|wrong item|fortrudt|unwanted|forkert størrelse|too small|too large)\b/.test(
      text
    )
  ) {
    return {
      restock: true,
      confidence: "medium",
      reason: "AI vurderer at varen typisk kan restockes for denne returgrund.",
    };
  }
  return {
    restock: true,
    confidence: "low",
    reason: "AI er usikker og bruger sikker standard: restock = true.",
  };
}

function connectionNodes(connection) {
  if (!connection || typeof connection !== "object") return [];
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection?.edges)) {
    return connection.edges
      .map((edge) => edge?.node)
      .filter(Boolean);
  }
  return [];
}

async function resolveFulfillmentLineItemId({ domain, token, orderGid, lineItemGid }) {
  if (!orderGid || !lineItemGid) return "";
  let fulfillments = [];
  try {
    const data = await shopifyGraphql({
      domain,
      token,
      query: `query ResolveFulfillmentLineItemConnection($orderId: ID!) {
        order(id: $orderId) {
          fulfillments(first: 50) {
            nodes {
              fulfillmentLineItems(first: 250) {
                nodes {
                  id
                  lineItem { id }
                }
                edges {
                  node {
                    id
                    lineItem { id }
                  }
                }
              }
            }
            edges {
              node {
                fulfillmentLineItems(first: 250) {
                  nodes {
                    id
                    lineItem { id }
                  }
                  edges {
                    node {
                      id
                      lineItem { id }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      variables: { orderId: orderGid },
    });
    fulfillments = connectionNodes(data?.order?.fulfillments);
  } catch {
    const data = await shopifyGraphql({
      domain,
      token,
      query: `query ResolveFulfillmentLineItemList($orderId: ID!) {
        order(id: $orderId) {
          fulfillments {
            fulfillmentLineItems(first: 250) {
              nodes {
                id
                lineItem { id }
              }
              edges {
                node {
                  id
                  lineItem { id }
                }
              }
            }
          }
        }
      }`,
      variables: { orderId: orderGid },
    });
    fulfillments = Array.isArray(data?.order?.fulfillments) ? data.order.fulfillments : [];
  }
  for (const fulfillment of fulfillments) {
    const nodes = connectionNodes(fulfillment?.fulfillmentLineItems);
    for (const node of nodes) {
      const currentLineItemId = asString(node?.lineItem?.id);
      const currentFulfillmentLineItemId = asString(node?.id);
      if (
        currentLineItemId &&
        currentFulfillmentLineItemId &&
        currentLineItemId === lineItemGid &&
        currentFulfillmentLineItemId.startsWith("gid://shopify/FulfillmentLineItem/")
      ) {
        return currentFulfillmentLineItemId;
      }
    }
  }
  return "";
}

async function resolveAnyFulfillmentLineItemId({
  domain,
  token,
  orderGid,
  preferredVariantGid = "",
}) {
  if (!orderGid) return "";
  let fulfillments = [];
  try {
    const data = await shopifyGraphql({
      domain,
      token,
      query: `query ResolveAnyFulfillmentLineItemConnection($orderId: ID!) {
        order(id: $orderId) {
          fulfillments(first: 50) {
            nodes {
              fulfillmentLineItems(first: 250) {
                nodes {
                  id
                  lineItem {
                    variant { id }
                  }
                }
                edges {
                  node {
                    id
                    lineItem {
                      variant { id }
                    }
                  }
                }
              }
            }
            edges {
              node {
                fulfillmentLineItems(first: 250) {
                  nodes {
                    id
                    lineItem {
                      variant { id }
                    }
                  }
                  edges {
                    node {
                      id
                      lineItem {
                        variant { id }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      variables: { orderId: orderGid },
    });
    fulfillments = connectionNodes(data?.order?.fulfillments);
  } catch {
    const data = await shopifyGraphql({
      domain,
      token,
      query: `query ResolveAnyFulfillmentLineItemList($orderId: ID!) {
        order(id: $orderId) {
          fulfillments {
            fulfillmentLineItems(first: 250) {
              nodes {
                id
                lineItem {
                  variant { id }
                }
              }
              edges {
                node {
                  id
                  lineItem {
                    variant { id }
                  }
                }
              }
            }
          }
        }
      }`,
      variables: { orderId: orderGid },
    });
    fulfillments = Array.isArray(data?.order?.fulfillments) ? data.order.fulfillments : [];
  }
  const allItems = [];
  for (const fulfillment of fulfillments) {
    const nodes = connectionNodes(fulfillment?.fulfillmentLineItems);
    for (const node of nodes) {
      const id = asString(node?.id);
      const variantId = asString(node?.lineItem?.variant?.id);
      if (id) allItems.push({ id, variantId });
    }
  }
  if (preferredVariantGid) {
    const byVariant = allItems.find((item) => item.variantId && item.variantId === preferredVariantGid);
    if (byVariant?.id) return byVariant.id;
  }
  const uniqueIds = Array.from(new Set(allItems.map((item) => item.id).filter(Boolean)));
  if (uniqueIds.length === 1) return uniqueIds[0];
  if (uniqueIds.length > 1) return uniqueIds[0];
  return "";
}

async function resolveFromReturnableFulfillments({
  domain,
  token,
  orderGid,
  preferredLineItemGid = "",
  preferredVariantGid = "",
}) {
  if (!orderGid) return "";
  const data = await shopifyGraphql({
    domain,
    token,
    query: `query ResolveReturnableFulfillmentLineItem($orderId: ID!) {
      order(id: $orderId) {
        returnableFulfillments(first: 50) {
          nodes {
            returnableFulfillmentLineItems(first: 250) {
              nodes {
                fulfillmentLineItem {
                  id
                  lineItem {
                    id
                    variant {
                      id
                    }
                  }
                }
              }
              edges {
                node {
                  fulfillmentLineItem {
                    id
                    lineItem {
                      id
                      variant {
                        id
                      }
                    }
                  }
                }
              }
            }
          }
          edges {
            node {
              returnableFulfillmentLineItems(first: 250) {
                nodes {
                  fulfillmentLineItem {
                    id
                    lineItem {
                      id
                      variant {
                        id
                      }
                    }
                  }
                }
                edges {
                  node {
                    fulfillmentLineItem {
                      id
                      lineItem {
                        id
                        variant {
                          id
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    variables: { orderId: orderGid },
  });

  const returnableFulfillments = connectionNodes(data?.order?.returnableFulfillments);
  const candidates = [];
  for (const returnable of returnableFulfillments) {
    const items = connectionNodes(returnable?.returnableFulfillmentLineItems);
    for (const item of items) {
      const fulfillmentLineItemId = asString(item?.fulfillmentLineItem?.id);
      const lineItemId = asString(item?.fulfillmentLineItem?.lineItem?.id);
      const variantId = asString(item?.fulfillmentLineItem?.lineItem?.variant?.id);
      if (
        fulfillmentLineItemId &&
        fulfillmentLineItemId.startsWith("gid://shopify/FulfillmentLineItem/")
      ) {
        candidates.push({
          id: fulfillmentLineItemId,
          lineItemId,
          variantId,
        });
      }
    }
  }

  if (!candidates.length) return "";
  if (preferredLineItemGid) {
    const byLineItem = candidates.find((item) => item.lineItemId === preferredLineItemGid);
    if (byLineItem?.id) return byLineItem.id;
  }
  if (preferredVariantGid) {
    const byVariant = candidates.find((item) => item.variantId === preferredVariantGid);
    if (byVariant?.id) return byVariant.id;
  }
  return candidates[0]?.id || "";
}

async function diagnoseExchangeEligibility({ domain, token, orderGid }) {
  if (!orderGid) return "missing_order_gid";
  try {
    let status = "unknown";
    let fulfillmentCount = 0;
    let returnableCount = -1;
    try {
      const data = await shopifyGraphql({
        domain,
        token,
        query: `query DiagnoseExchangeEligibilityConnection($orderId: ID!) {
          order(id: $orderId) {
            displayFulfillmentStatus
            fulfillments(first: 50) { nodes { id } edges { node { id } } }
            returnableFulfillments(first: 50) { nodes { id } edges { node { id } } }
          }
        }`,
        variables: { orderId: orderGid },
      });
      status = asString(data?.order?.displayFulfillmentStatus) || status;
      fulfillmentCount = connectionNodes(data?.order?.fulfillments).length;
      returnableCount = connectionNodes(data?.order?.returnableFulfillments).length;
    } catch {
      const data = await shopifyGraphql({
        domain,
        token,
        query: `query DiagnoseExchangeEligibilityList($orderId: ID!) {
          order(id: $orderId) {
            displayFulfillmentStatus
            fulfillments { id }
          }
        }`,
        variables: { orderId: orderGid },
      });
      status = asString(data?.order?.displayFulfillmentStatus) || status;
      fulfillmentCount = Array.isArray(data?.order?.fulfillments) ? data.order.fulfillments.length : 0;
      returnableCount = -1;
    }
    return `fulfillment_status=${status}; fulfillments=${fulfillmentCount}; returnable_fulfillments=${returnableCount}`;
  } catch (error) {
    return `diagnose_failed=${error instanceof Error ? error.message : String(error)}`;
  }
}

async function createExchangeRequest({ domain, token, orderId, payload = {} }) {
  const orderGid = toShopifyGid("Order", orderId);
  const normalized = normalizeExchangePayload(payload);
  if (!orderGid) {
    throw Object.assign(new Error("Could not resolve order ID for exchange."), { status: 400 });
  }
  if (!normalized.exchangeVariantId) {
    throw Object.assign(new Error("Exchange requires exchange_variant_id (variant to send out)."), {
      status: 400,
    });
  }
  if (!normalized.exchangeVariantId.startsWith("gid://shopify/ProductVariant/")) {
    throw Object.assign(new Error("exchange_variant_id must be a ProductVariant gid."), {
      status: 400,
    });
  }

  let fulfillmentLineItemId = normalized.returnFulfillmentLineItemId;
  if (!fulfillmentLineItemId && normalized.returnLineItemId) {
    try {
      fulfillmentLineItemId = await resolveFulfillmentLineItemId({
        domain,
        token,
        orderGid,
        lineItemGid: normalized.returnLineItemId,
      });
    } catch {
      fulfillmentLineItemId = "";
    }
  }
  if (!fulfillmentLineItemId) {
    try {
      fulfillmentLineItemId = await resolveAnyFulfillmentLineItemId({
        domain,
        token,
        orderGid,
        preferredVariantGid: normalized.exchangeVariantId,
      });
    } catch {
      fulfillmentLineItemId = "";
    }
  }
  if (!fulfillmentLineItemId) {
    try {
      fulfillmentLineItemId = await resolveFromReturnableFulfillments({
        domain,
        token,
        orderGid,
        preferredLineItemGid: normalized.returnLineItemId,
        preferredVariantGid: normalized.exchangeVariantId,
      });
    } catch {
      fulfillmentLineItemId = "";
    }
  }
  if (!fulfillmentLineItemId) {
    const diag = await diagnoseExchangeEligibility({
      domain,
      token,
      orderGid,
    });
    throw Object.assign(
      new Error(
        `Exchange requires return_fulfillment_line_item_id (or a return_line_item_id that maps to a fulfilled line item). ${diag}`
      ),
      { status: 400 }
    );
  }

  const linePayload = {
    quantity: normalized.returnQuantity,
    fulfillmentLineItemId,
    returnReason: normalized.returnReason || "UNKNOWN",
    ...(normalized.returnReasonNote ? { returnReasonNote: normalized.returnReasonNote } : {}),
  };
  const exchangePayload = {
    quantity: normalized.exchangeQuantity,
    variantId: normalized.exchangeVariantId,
  };

  const createAttempts = [
    {
      query: `mutation ReturnCreate($input: ReturnInput!) {
        returnCreate(returnInput: $input) {
          return { id status }
          userErrors { field message }
        }
      }`,
      variables: {
        input: {
          orderId: orderGid,
          returnLineItems: [linePayload],
          exchangeLineItems: [exchangePayload],
        },
      },
      pick: (data) => data?.returnCreate,
    },
  ];

  let returnId = "";
  let createResult = null;
  let lastCreateError = null;

  for (const attempt of createAttempts) {
    try {
      const data = await shopifyGraphql({
        domain,
        token,
        query: attempt.query,
        variables: attempt.variables,
      });
      const scope = attempt.pick(data) || null;
      assertMutationUserErrors(scope, "Could not create exchange return.");
      returnId = asString(scope?.return?.id);
      createResult = scope?.return || null;
      if (returnId) break;
    } catch (error) {
      lastCreateError = error;
    }
  }

  if (!returnId) {
    const message =
      lastCreateError instanceof Error
        ? lastCreateError.message
        : "Could not create exchange request in Shopify.";
    throw Object.assign(new Error(message), { status: 400 });
  }

  return {
    response: { ok: true, status: 200 },
    payload: {
      return_id: returnId,
      return: createResult,
      return_reason: normalized.returnReason || "UNKNOWN",
      process_error: null,
      auto_processed: false,
    },
  };
}

async function processExchangeReturn({ domain, token, payload = {} }) {
  const returnId = toShopifyReturnGid(payload?.return_id ?? payload?.returnId);
  if (!returnId) {
    throw Object.assign(new Error("Process return requires return_id."), { status: 400 });
  }

  let returnLineItems = [];
  let exchangeLineItems = [];
  try {
    const data = await shopifyGraphql({
      domain,
      token,
      query: `query ReturnForProcess($id: ID!) {
        return(id: $id) {
          id
          returnLineItems(first: 50) {
            nodes { id quantity }
            edges { node { id quantity } }
          }
          exchangeLineItems(first: 50) {
            nodes { id quantity }
            edges { node { id quantity } }
          }
        }
      }`,
      variables: { id: returnId },
    });
    returnLineItems = connectionNodes(data?.return?.returnLineItems)
      .map((item) => ({
        id: asString(item?.id),
        quantity: Math.max(1, Math.trunc(asNumber(item?.quantity) ?? 1)),
      }))
      .filter((item) => item.id);
    exchangeLineItems = connectionNodes(data?.return?.exchangeLineItems)
      .map((item) => ({
        id: asString(item?.id),
        quantity: Math.max(1, Math.trunc(asNumber(item?.quantity) ?? 1)),
      }))
      .filter((item) => item.id);
  } catch {
    returnLineItems = [];
    exchangeLineItems = [];
  }

  const enrichedInput = {
    returnId,
    returnLineItems: returnLineItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    })),
    exchangeLineItems: exchangeLineItems.map((item) => ({
      id: item.id,
      quantity: item.quantity,
    })),
  };

  // This schema only supports input-based returnProcess. restock behavior may be handled in Shopify UI.
  const attempts = [
    {
      query: `mutation ReturnProcess($input: ReturnProcessInput!) {
        returnProcess(input: $input) {
          return { id status }
          userErrors { field message }
        }
      }`,
      variables: { input: enrichedInput },
      pick: (data) => data?.returnProcess,
    },
    // Fallback if returnLineItems/exchangeLineItems should be omitted by schema.
    {
      query: `mutation ReturnProcess($input: ReturnProcessInput!) {
        returnProcess(input: $input) {
          return { id status }
          userErrors { field message }
        }
      }`,
      variables: { input: { returnId } },
      pick: (data) => data?.returnProcess,
    },
  ];

  const processErrors = [];
  for (const attempt of attempts) {
    try {
      const data = await shopifyGraphql({
        domain,
        token,
        query: attempt.query,
        variables: attempt.variables,
      });
      const scope = attempt.pick(data) || null;
      assertMutationUserErrors(scope, "Could not process return.");
      return {
        response: { ok: true, status: 200 },
        payload: {
          return_id: returnId,
          processed: true,
          process_error: null,
        },
      };
    } catch (error) {
      processErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const uniqueErrors = Array.from(new Set(processErrors.filter(Boolean)));
  throw Object.assign(new Error(`Could not process return ${returnId}. ${uniqueErrors.join("; ")}`), {
    status: 400,
  });
}

async function resolveOrder({ domain, token, orderId, orderNumber }) {
  if (orderId) {
    const result = await shopifyRequest({
      domain,
      token,
      path: `/orders/${encodeURIComponent(
        String(orderId)
      )}.json?fields=id,name,order_number,shipping_address,fulfillment_status,cancelled_at,closed_at,fulfillments`,
    });
    if (result.response.ok && result.payload?.order) {
      return result.payload.order;
    }
  }

  if (!orderNumber) return null;
  const result = await shopifyRequest({
    domain,
    token,
    path: `/orders.json?status=any&limit=25&fields=id,name,order_number,shipping_address,fulfillment_status,cancelled_at,closed_at,fulfillments&name=${encodeURIComponent(
      `#${orderNumber}`
    )}`,
  });
  if (!result.response.ok) return null;
  const orders = Array.isArray(result.payload?.orders) ? result.payload.orders : [];
  if (!orders.length) return null;
  return orders.find((order) => matchesOrderNumber(order, orderNumber)) || null;
}

async function getPrimaryFulfillmentOrderId({ domain, token, orderId }) {
  const result = await shopifyRequest({
    domain,
    token,
    path: `/orders/${encodeURIComponent(String(orderId))}/fulfillment_orders.json`,
  });
  if (!result.response.ok) return null;
  const list = Array.isArray(result.payload?.fulfillment_orders)
    ? result.payload.fulfillment_orders
    : [];
  return asNumber(list[0]?.id);
}

async function executeShopifyAction({ domain, token, actionType, orderId, payload = {}, order }) {
  switch (actionType) {
    case "update_shipping_address": {
      const shippingAddress = payload?.shipping_address ?? payload?.shippingAddress;
      const inferredAddress =
        shippingAddress && typeof shippingAddress === "object"
          ? shippingAddress
          : parseAddressFromText(payload?.detailText || "") || null;
      if (!inferredAddress || typeof inferredAddress !== "object") {
        throw Object.assign(new Error("Could not parse shipping address payload."), { status: 400 });
      }
      const mergedShipping = {
        ...(order?.shipping_address || {}),
        ...inferredAddress,
      };
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, shipping_address: mergedShipping } },
      });
    }
    case "cancel_order": {
      const body = {};
      if (asString(payload?.reason)) body.reason = asString(payload.reason);
      if (asString(payload?.email)) body.email = asString(payload.email);
      if (typeof payload?.refund === "boolean") body.refund = payload.refund;
      if (typeof payload?.restock === "boolean") body.restock = payload.restock;
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/cancel.json`,
        method: "POST",
        body,
      });
    }
    case "refund_order": {
      const amount = asNumber(payload?.amount);
      const currency = asString(payload?.currency || payload?.currency_code);
      const reason = asString(payload?.reason);
      const note = asString(payload?.note);
      const transactions = amount
        ? [
            {
              kind: "refund",
              amount: amount.toFixed(2),
              ...(currency ? { currency } : {}),
            },
          ]
        : [];
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/refunds.json`,
        method: "POST",
        body: {
          refund: {
            notify: true,
            ...(note ? { note } : {}),
            ...(reason ? { reason } : {}),
            ...(transactions.length ? { transactions } : {}),
          },
        },
      });
    }
    case "create_exchange_request":
      return await createExchangeRequest({
        domain,
        token,
        orderId,
        payload,
      });
    case "process_exchange_return":
      return await processExchangeReturn({
        domain,
        token,
        payload,
      });
    case "change_shipping_method": {
      const title = asString(payload?.title ?? payload?.shipping_title);
      const price = asString(payload?.price);
      if (!title || !price) {
        throw Object.assign(new Error("Shipping method change requires title and price."), {
          status: 400,
        });
      }
      const code = asString(payload?.code ?? payload?.shipping_code);
      const source = asString(payload?.source) || "manual";
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: {
          order: {
            id: orderId,
            shipping_lines: [{ title, price, ...(code ? { code } : {}), ...(source ? { source } : {}) }],
          },
        },
      });
    }
    case "hold_or_release_fulfillment": {
      const mode = asString(payload?.mode ?? payload?.operation).toLowerCase() || "hold";
      const fulfillmentOrderId =
        asNumber(payload?.fulfillment_order_id ?? payload?.fulfillmentOrderId) ||
        (await getPrimaryFulfillmentOrderId({ domain, token, orderId }));
      if (!fulfillmentOrderId) {
        throw Object.assign(new Error("Could not resolve fulfillment order for hold/release."), {
          status: 404,
        });
      }
      if (mode === "release") {
        return await shopifyRequest({
          domain,
          token,
          path: `/fulfillment_orders/${encodeURIComponent(String(fulfillmentOrderId))}/release_hold.json`,
          method: "POST",
        });
      }
      const reason = asString(payload?.reason);
      const reasonNotes = asString(payload?.reason_notes ?? payload?.note);
      const holdPayload = {};
      if (reason) holdPayload.reason = reason;
      if (reasonNotes) holdPayload.reason_notes = reasonNotes;
      return await shopifyRequest({
        domain,
        token,
        path: `/fulfillment_orders/${encodeURIComponent(String(fulfillmentOrderId))}/hold.json`,
        method: "POST",
        body: Object.keys(holdPayload).length
          ? { fulfillment_hold: holdPayload }
          : undefined,
      });
    }
    case "edit_line_items": {
      const operations = parseLineItemOperations(payload);
      if (!operations.length) {
        throw Object.assign(
          new Error(
            "Line item edits require payload.operations with set_quantity/remove_line_item/add_variant."
          ),
          { status: 400 }
        );
      }

      const orderGid = toShopifyGid("Order", orderId);
      const beginData = await shopifyGraphql({
        domain,
        token,
        query: `mutation OrderEditBegin($id: ID!) {
          orderEditBegin(id: $id) {
            calculatedOrder { id }
            userErrors { message }
          }
        }`,
        variables: { id: orderGid },
      });
      const beginScope = beginData?.orderEditBegin || null;
      assertMutationUserErrors(beginScope, "Could not begin order edit.");
      const calculatedOrderId = beginScope?.calculatedOrder?.id;
      if (!calculatedOrderId) {
        throw Object.assign(new Error("Could not resolve calculated order id."), { status: 400 });
      }

      for (const operation of operations) {
        if (operation.type === "add_variant") {
          const addData = await shopifyGraphql({
            domain,
            token,
            query: `mutation AddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
              orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
                userErrors { message }
              }
            }`,
            variables: {
              id: calculatedOrderId,
              variantId: operation.variantId,
              quantity: operation.quantity,
            },
          });
          assertMutationUserErrors(addData?.orderEditAddVariant, "Could not add variant.");
          continue;
        }

        const setData = await shopifyGraphql({
          domain,
          token,
          query: `mutation SetQuantity($id: ID!, $lineItemId: ID!, $quantity: Int!) {
            orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
              userErrors { message }
            }
          }`,
          variables: {
            id: calculatedOrderId,
            lineItemId: operation.lineItemId,
            quantity: operation.quantity,
          },
        });
        assertMutationUserErrors(setData?.orderEditSetQuantity, "Could not update line item quantity.");
      }

      const staffNote = asString(payload?.edit_summary ?? payload?.summary ?? payload?.requested_changes);
      const commitData = await shopifyGraphql({
        domain,
        token,
        query: `mutation CommitEdit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
          orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
            order { id }
            userErrors { message }
          }
        }`,
        variables: {
          id: calculatedOrderId,
          notifyCustomer: false,
          ...(staffNote ? { staffNote } : {}),
        },
      });
      assertMutationUserErrors(commitData?.orderEditCommit, "Could not commit order edit.");
      if (!commitData?.orderEditCommit?.order?.id) {
        throw Object.assign(new Error("Order edit commit did not return an order."), { status: 400 });
      }
      return { response: { ok: true, status: 200 }, payload: commitData };
    }
    case "update_customer_contact": {
      const email = asString(payload?.email);
      const phone = asString(payload?.phone);
      if (!email && !phone) {
        throw Object.assign(new Error("Contact update requires email or phone."), {
          status: 400,
        });
      }
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, ...(email ? { email } : {}), ...(phone ? { phone } : {}) } },
      });
    }
    case "add_note":
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, note: asString(payload?.note) } },
      });
    case "add_tag": {
      const tag = asString(payload?.tag);
      if (!tag) {
        throw Object.assign(new Error("Tag update requires tag."), { status: 400 });
      }
      const current = await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
      });
      const existingTags = String(current?.payload?.order?.tags || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (!existingTags.includes(tag)) existingTags.push(tag);
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}.json`,
        method: "PUT",
        body: { order: { id: orderId, tags: existingTags.join(", ") } },
      });
    }
    case "add_internal_note_or_tag":
      if (asString(payload?.tag)) {
        return await executeShopifyAction({
          domain,
          token,
          actionType: "add_tag",
          orderId,
          payload,
          order,
        });
      }
      return await executeShopifyAction({
        domain,
        token,
        actionType: "add_note",
        orderId,
        payload,
        order,
      });
    case "resend_confirmation_or_invoice": {
      const to = asString(payload?.to_email ?? payload?.email);
      const customMessage = asString(payload?.message);
      return await shopifyRequest({
        domain,
        token,
        path: `/orders/${encodeURIComponent(String(orderId))}/send_invoice.json`,
        method: "POST",
        body: {
          invoice: {
            ...(to ? { to } : {}),
            ...(customMessage ? { custom_message: customMessage } : {}),
          },
        },
      });
    }
    default:
      throw Object.assign(new Error(`Unsupported action type: ${actionType}`), { status: 400 });
  }
}

export async function GET(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;
  if (!scope?.workspaceId && !supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }

  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  let actionQuery = serviceClient
    .from("thread_actions")
    .select("id, action_type, status, detail, payload, error, created_at, updated_at")
    .eq("thread_id", thread.id)
    .order("updated_at", { ascending: false })
    .limit(1);
  actionQuery = applyScope(actionQuery, scope);
  const { data: latestAction, error: latestActionError } = await actionQuery.maybeSingle();
  if (latestActionError) {
    return NextResponse.json({ error: latestActionError.message }, { status: 500 });
  }
  let latestReturnCase = null;
  if (scope?.workspaceId) {
    const { data } = await serviceClient
      .from("return_cases")
      .select(
        "id, status, is_eligible, eligibility_reason, return_shipping_mode, reason, shopify_order_id, customer_email, created_at, updated_at",
      )
      .eq("thread_id", thread.id)
      .eq("workspace_id", scope.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestReturnCase = data || null;
  }
  if (!latestAction) {
    return NextResponse.json({ action: null, returnCase: latestReturnCase || null }, { status: 200 });
  }

  const normalizedStatus = normalizeActionStatus(latestAction.status);
  const rawStatus = asString(latestAction.status) || normalizedStatus;
  const actionPayload =
    latestAction?.payload && typeof latestAction.payload === "object"
      ? latestAction.payload
      : {};
  const testModeAction =
    rawStatus.toLowerCase() === "approved_test_mode" ||
    normalizedStatus === "approved_test_mode" ||
    actionPayload?.test_mode === true ||
    actionPayload?.simulated === true;
  return NextResponse.json(
    {
      action: {
        id: String(latestAction.id || ""),
        detail:
          asString(latestAction.detail) ||
          "Sona wants to apply an order update for this customer.",
        actionType: asString(latestAction.action_type) || null,
        payload:
          actionPayload,
        createdAt: latestAction.created_at || null,
        updatedAt: latestAction.updated_at || latestAction.created_at || null,
        status: rawStatus,
        normalizedStatus: normalizedStatus,
        testMode: testModeAction,
        error:
          asString(latestAction.error) ||
          (testModeAction
            ? "Action approved, but no changes were made because Test Mode is enabled."
            : null),
      },
      returnCase: latestReturnCase,
    },
    { status: 200 }
  );
}

export async function POST(request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  const threadId = params?.threadId;
  if (!threadId) {
    return NextResponse.json({ error: "threadId is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const decisionRaw = String(body?.decision || "accepted").trim().toLowerCase();
  const decision = decisionRaw === "denied" || decisionRaw === "declined" ? "declined" : "accepted";
  const actionId = body?.actionId ? String(body.actionId).trim() : "";
  const proposalLogId = body?.proposalLogId ? String(body.proposalLogId) : "";
  const proposalText = body?.proposalText ? String(body.proposalText) : "";
  const payloadOverride =
    body?.payloadOverride && typeof body.payloadOverride === "object" ? body.payloadOverride : null;
  if (!actionId && !proposalLogId && !proposalText) {
    return NextResponse.json(
      { error: "actionId, proposalLogId or proposalText is required." },
      { status: 400 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const supabaseUserId = scope?.supabaseUserId ?? null;
  if (!scope?.workspaceId && !supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user scope." }, { status: 401 });
  }
  if (!supabaseUserId) {
    return NextResponse.json({ error: "Could not resolve user." }, { status: 401 });
  }
  let workspaceTestSettings = { testMode: false, testEmail: null };
  if (scope?.workspaceId) {
    try {
      workspaceTestSettings = await loadWorkspaceTestSettings(serviceClient, scope.workspaceId);
    } catch (error) {
      return NextResponse.json(
        { error: error?.message || "Could not resolve workspace test settings." },
        { status: 500 }
      );
    }
  }

  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, provider_thread_id, subject, snippet, user_id, workspace_id, mailbox_id, provider")
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError || !thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  let actionRecord = null;
  if (actionId) {
    let actionLookupQuery = serviceClient
      .from("thread_actions")
      .select(
        "id, user_id, thread_id, action_type, status, detail, payload, order_id, order_number, action_key"
      )
      .eq("id", actionId)
      .eq("thread_id", thread.id);
    actionLookupQuery = applyScope(actionLookupQuery, scope);
    const { data: actionRow, error: actionError } = await actionLookupQuery.maybeSingle();
    if (actionError) {
      return NextResponse.json({ error: actionError.message }, { status: 500 });
    }
    if (!actionRow) {
      return NextResponse.json({ error: "Action not found for this thread." }, { status: 404 });
    }
    actionRecord = actionRow;
  } else {
    let latestPendingQuery = serviceClient
      .from("thread_actions")
      .select(
        "id, user_id, thread_id, action_type, status, detail, payload, order_id, order_number, action_key"
      )
      .eq("thread_id", thread.id)
      .eq("status", "pending")
      .order("updated_at", { ascending: false })
      .limit(1);
    latestPendingQuery = applyScope(latestPendingQuery, scope);
    const { data: latestPending } = await latestPendingQuery.maybeSingle();
    if (latestPending) {
      actionRecord = latestPending;
    }
  }

  if (decision === "declined") {
    const nowIso = new Date().toISOString();
    if (actionRecord?.id) {
      const { error: updateActionError } = await serviceClient
        .from("thread_actions")
        .update({
          status: "declined",
          declined_at: nowIso,
          decided_at: nowIso,
          updated_at: nowIso,
          error: null,
        })
        .eq("id", actionRecord.id);
      if (updateActionError) {
        return NextResponse.json({ error: updateActionError.message }, { status: 500 });
      }
    }

    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: "shopify_action_declined",
      step_detail: JSON.stringify({
        thread_id: threadId,
        action: actionRecord?.action_type || null,
        detail: actionRecord?.detail || proposalText || null,
      }),
      status: "info",
      created_at: nowIso,
    });

    return NextResponse.json(
      {
        ok: true,
        decision: "declined",
        actionId: actionRecord?.id || null,
      },
      { status: 200 }
    );
  }

  let parsed = parseLogDetail(proposalText);
  let proposalStepName = "shopify_action";
  if (proposalLogId) {
    const { data: logRow } = await serviceClient
      .from("agent_logs")
      .select("id, draft_id, step_name, step_detail")
      .eq("id", proposalLogId)
      .maybeSingle();
    if (!logRow) {
      return NextResponse.json({ error: "Proposal log not found." }, { status: 404 });
    }
    if (logRow?.draft_id) {
      const { data: draftRow } = await serviceClient
        .from("drafts")
        .select("id, thread_id")
        .eq("id", logRow.draft_id)
        .maybeSingle();
      const validThread =
        draftRow?.thread_id &&
        [thread.id, thread.provider_thread_id].filter(Boolean).includes(draftRow.thread_id);
      if (!validThread) {
        return NextResponse.json(
          { error: "Proposal does not belong to this thread." },
          { status: 403 }
        );
      }
    }
    proposalStepName = String(logRow?.step_name || proposalStepName).toLowerCase();
    parsed = parseLogDetail(logRow?.step_detail || proposalText);
  }

  if (actionRecord?.detail || actionRecord?.action_type || actionRecord?.payload) {
    parsed = {
      ...parsed,
      detailText: asString(actionRecord.detail) || parsed.detailText,
      actionType: asString(actionRecord.action_type) || parsed.actionType,
      payload:
        actionRecord?.payload && typeof actionRecord.payload === "object"
          ? actionRecord.payload
          : parsed.payload,
      orderId: asString(actionRecord?.order_id) || parsed.orderId,
      orderNumber: asString(actionRecord?.order_number) || parsed.orderNumber,
    };
  }

  const detailText = String(parsed?.detailText || proposalText || "").trim();
  const inferredActionFromText = detailText.toLowerCase().startsWith("cancel")
    ? "cancel_order"
    : detailText.toLowerCase().startsWith("refund")
    ? "refund_order"
    : detailText.toLowerCase().includes("return instructions")
    ? "send_return_instructions"
    : detailText.toLowerCase().includes("create return case")
    ? "create_return_case"
    : detailText.toLowerCase().includes("process return")
    ? "process_exchange_return"
    : detailText.toLowerCase().includes("exchange") ||
      detailText.toLowerCase().includes("ombyt")
    ? "create_exchange_request"
    : detailText.toLowerCase().includes("tag")
    ? "add_tag"
    : detailText.toLowerCase().includes("invoice")
    ? "resend_confirmation_or_invoice"
    : detailText.toLowerCase().includes("contact")
    ? "update_customer_contact"
    : detailText.toLowerCase().includes("shipping method")
    ? "change_shipping_method"
    : detailText.toLowerCase().includes("fulfillment hold")
    ? "hold_or_release_fulfillment"
    : detailText.toLowerCase().includes("line item")
    ? "edit_line_items"
    : "update_shipping_address";
  const actionType =
    asString(parsed?.actionType) || asString(parsed?.payload?.actionType) || inferredActionFromText;
  const normalizedActionType = actionType.trim();
  const normalizedExistingStatus = normalizeActionStatus(actionRecord?.status || "");
  if (normalizedExistingStatus === "applied") {
    return NextResponse.json(
      {
        ok: true,
        action: normalizedActionType,
        orderId: parsed?.orderId || actionRecord?.order_id || null,
        orderNumber: parsed?.orderNumber || actionRecord?.order_number || null,
        detail: detailText || null,
        sourceStep: proposalStepName,
        alreadyApplied: true,
      },
      { status: 200 }
    );
  }
  if (normalizedExistingStatus === "declined") {
    return NextResponse.json(
      {
        ok: true,
        action: normalizedActionType,
        orderId: parsed?.orderId || actionRecord?.order_id || null,
        orderNumber: parsed?.orderNumber || actionRecord?.order_number || null,
        detail: detailText || null,
        sourceStep: proposalStepName,
        alreadyDeclined: true,
      },
      { status: 200 }
    );
  }

  if (normalizedActionType === "create_return_case" || normalizedActionType === "send_return_instructions") {
    const nowIso = new Date().toISOString();
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "Return actions require workspace scope." }, { status: 400 });
    }

    const mergedPayload = {
      ...(actionRecord?.payload && typeof actionRecord.payload === "object" ? actionRecord.payload : {}),
      ...(parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {}),
      ...(payloadOverride && typeof payloadOverride === "object" ? payloadOverride : {}),
    };
    const inferredOrderId = asString(parsed?.orderId || actionRecord?.order_id || mergedPayload?.order_id || "");
    const actionKey =
      actionRecord?.action_key ||
      buildActionKey(normalizedActionType, inferredOrderId || "return", mergedPayload);

    if (normalizedActionType === "create_return_case") {
      const eligibility = mergedPayload?.eligibility && typeof mergedPayload.eligibility === "object"
        ? mergedPayload.eligibility
        : {};
      const returnCase = await upsertReturnCase({
        serviceClient,
        workspaceId: scope.workspaceId,
        threadId: thread.id,
        payload: {
          ...mergedPayload,
          shopify_order_id: inferredOrderId || asString(mergedPayload?.shopify_order_id || ""),
        },
        status:
          mergedPayload?.is_eligible === false || eligibility?.eligible === false ? "rejected" : "requested",
        isEligible:
          typeof mergedPayload?.is_eligible === "boolean"
            ? mergedPayload.is_eligible
            : typeof eligibility?.eligible === "boolean"
            ? eligibility.eligible
            : null,
        eligibilityReason:
          asString(mergedPayload?.eligibility_reason || eligibility?.reason || "") || null,
      });

      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "applied",
            detail: detailText || "Return case created.",
            payload: { ...mergedPayload, return_case_id: returnCase?.id || null },
            action_type: normalizedActionType,
            action_key: actionKey,
            decided_at: nowIso,
            applied_at: nowIso,
            updated_at: nowIso,
            error: null,
          })
          .eq("id", actionRecord.id);
      } else {
        await serviceClient.from("thread_actions").insert({
          user_id: supabaseUserId,
          workspace_id: scope.workspaceId ?? null,
          thread_id: thread.id,
          action_type: normalizedActionType,
          action_key: actionKey,
          status: "applied",
          detail: detailText || "Return case created.",
          payload: { ...mergedPayload, return_case_id: returnCase?.id || null },
          source: "manual_approval",
          decided_at: nowIso,
          applied_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
          error: null,
        });
      }
      return NextResponse.json(
        {
          ok: true,
          decision: "accepted",
          action: normalizedActionType,
          returnCase: returnCase || null,
          sourceStep: proposalStepName,
        },
        { status: 200 }
      );
    }

    const inboundMessage = await loadLatestInboundMessage(serviceClient, scope, thread.id);
    const mailboxSender = await loadMailboxSender(serviceClient, scope, thread.mailbox_id || null);
    const customerEmail = asString(
      mergedPayload?.customer_email || inboundMessage?.from_email || ""
    ).toLowerCase();
    if (!customerEmail) {
      return NextResponse.json({ error: "Customer email is missing for return instructions." }, { status: 400 });
    }
    const customerName = asString(inboundMessage?.from_name || "").split(/\s+/)[0] || "";
    const eligibility = mergedPayload?.eligibility && typeof mergedPayload.eligibility === "object"
      ? mergedPayload.eligibility
      : {};
    const returnWindowDays = Math.max(
      1,
      Math.trunc(asNumber(mergedPayload?.return_window_days) || 30)
    );
    const returnShippingMode = asString(mergedPayload?.return_shipping_mode || "customer_paid") || "customer_paid";
    const returnAddress = asString(mergedPayload?.return_address || "");
    const requireUnused =
      typeof mergedPayload?.require_unused === "boolean" ? mergedPayload.require_unused : true;
    const requireOriginalPackaging =
      typeof mergedPayload?.require_original_packaging === "boolean"
        ? mergedPayload.require_original_packaging
        : true;
    const instructionsText = buildReturnInstructionsBody({
      customerName,
      returnWindowDays,
      returnAddress,
      requireUnused,
      requireOriginalPackaging,
      returnShippingMode,
    });

    if (workspaceTestSettings.testMode) {
      const testMessage = "Action approved, but no changes were made because Test Mode is enabled.";
      const returnCase = await upsertReturnCase({
        serviceClient,
        workspaceId: scope.workspaceId,
        threadId: thread.id,
        payload: {
          ...mergedPayload,
          customer_email: customerEmail,
          shopify_order_id: inferredOrderId || asString(mergedPayload?.shopify_order_id || ""),
          return_shipping_mode: returnShippingMode,
        },
        status: "requested",
        isEligible:
          typeof eligibility?.eligible === "boolean" ? eligibility.eligible : null,
        eligibilityReason: asString(eligibility?.reason || "") || null,
      });
      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "approved_test_mode",
            detail: testMessage,
            payload: {
              ...mergedPayload,
              simulated: true,
              test_mode: true,
              customer_email: customerEmail,
              return_case_id: returnCase?.id || null,
              instructions_text: instructionsText,
            },
            action_type: normalizedActionType,
            action_key: actionKey,
            decided_at: nowIso,
            updated_at: nowIso,
            error: testMessage,
          })
          .eq("id", actionRecord.id);
      } else {
        await serviceClient.from("thread_actions").insert({
          user_id: supabaseUserId,
          workspace_id: scope.workspaceId ?? null,
          thread_id: thread.id,
          action_type: normalizedActionType,
          action_key: actionKey,
          status: "approved_test_mode",
          detail: testMessage,
          payload: {
            ...mergedPayload,
            simulated: true,
            test_mode: true,
            customer_email: customerEmail,
            return_case_id: returnCase?.id || null,
            instructions_text: instructionsText,
          },
          source: "manual_approval",
          decided_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
          error: testMessage,
        });
      }
      return NextResponse.json(
        {
          ok: true,
          decision: "accepted",
          action: normalizedActionType,
          simulated: true,
          testMode: true,
          message: testMessage,
          returnCase: returnCase || null,
        },
        { status: 200 }
      );
    }

    const subjectLine = `Re: ${asString(inboundMessage?.subject || thread.subject || "Return request")}`;
    const sent = await sendPostmarkEmail({
      From: `${mailboxSender.fromName} <${mailboxSender.fromEmail}>`,
      To: customerEmail,
      Subject: subjectLine.slice(0, 250),
      TextBody: instructionsText,
      ReplyTo: mailboxSender.fromEmail,
    });

    const returnCase = await upsertReturnCase({
      serviceClient,
      workspaceId: scope.workspaceId,
      threadId: thread.id,
      payload: {
        ...mergedPayload,
        customer_email: customerEmail,
        shopify_order_id: inferredOrderId || asString(mergedPayload?.shopify_order_id || ""),
        return_shipping_mode: returnShippingMode,
      },
      status: "instructions_sent",
      isEligible:
        typeof eligibility?.eligible === "boolean" ? eligibility.eligible : null,
      eligibilityReason: asString(eligibility?.reason || "") || null,
    });

    const actionPayload = {
      ...mergedPayload,
      customer_email: customerEmail,
      return_case_id: returnCase?.id || null,
      postmark_message_id: asString(sent?.MessageID || "") || null,
      instructions_text: instructionsText,
    };
    if (actionRecord?.id) {
      await serviceClient
        .from("thread_actions")
        .update({
          status: "applied",
          detail: "Return instructions sent to customer.",
          payload: actionPayload,
          action_type: normalizedActionType,
          action_key: actionKey,
          decided_at: nowIso,
          applied_at: nowIso,
          updated_at: nowIso,
          error: null,
        })
        .eq("id", actionRecord.id);
    } else {
      await serviceClient.from("thread_actions").insert({
        user_id: supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        thread_id: thread.id,
        action_type: normalizedActionType,
        action_key: actionKey,
        status: "applied",
        detail: "Return instructions sent to customer.",
        payload: actionPayload,
        source: "manual_approval",
        decided_at: nowIso,
        applied_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        error: null,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        decision: "accepted",
        action: normalizedActionType,
        detail: "Return instructions sent to customer.",
        returnCase: returnCase || null,
        provider_message_id: asString(sent?.MessageID || "") || null,
        sourceStep: proposalStepName,
      },
      { status: 200 }
    );
  }

  if (normalizedActionType === "forward_email") {
    const nowIso = new Date().toISOString();
    const targetEmail = asString(
      payloadOverride?.target_email ||
        parsed?.payload?.target_email ||
        parsed?.payload?.forward_to_email ||
        actionRecord?.payload?.target_email ||
        ""
    ).toLowerCase();
    if (!targetEmail) {
      return NextResponse.json(
        { error: "Forward target email is missing for forward_email action." },
        { status: 400 }
      );
    }

    const actionKey =
      actionRecord?.action_key ||
      buildActionKey("forward_email", thread.id, {
        target_email: targetEmail,
        original_message_id:
          asString(parsed?.payload?.original_message_id || actionRecord?.payload?.original_message_id) ||
          null,
      });
    const payloadForForward = {
      ...(actionRecord?.payload && typeof actionRecord.payload === "object" ? actionRecord.payload : {}),
      ...(parsed?.payload && typeof parsed.payload === "object" ? parsed.payload : {}),
      ...(payloadOverride && typeof payloadOverride === "object" ? payloadOverride : {}),
      target_email: targetEmail,
    };

    if (workspaceTestSettings.testMode) {
      const simulatedMessage =
        "Action approved, but no changes were made because Test Mode is enabled.";
      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "approved_test_mode",
            detail: simulatedMessage,
            payload: { ...payloadForForward, simulated: true, test_mode: true },
            action_type: "forward_email",
            action_key: actionKey,
            decided_at: nowIso,
            updated_at: nowIso,
            error: simulatedMessage,
          })
          .eq("id", actionRecord.id);
      } else {
        await serviceClient.from("thread_actions").insert({
          user_id: supabaseUserId,
          workspace_id: scope.workspaceId ?? null,
          thread_id: thread.id,
          action_type: "forward_email",
          action_key: actionKey,
          status: "approved_test_mode",
          detail: simulatedMessage,
          payload: { ...payloadForForward, simulated: true, test_mode: true },
          source: "manual_approval",
          error: simulatedMessage,
          decided_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
      return NextResponse.json(
        {
          ok: true,
          decision: "accepted",
          action: "forward_email",
          simulated: true,
          testMode: true,
          message: simulatedMessage,
          sourceStep: proposalStepName,
        },
        { status: 200 }
      );
    }

    const forwardContext = await loadForwardingContext(serviceClient, scope, thread, payloadForForward);
    const { textBody, htmlBody } = buildForwardBodies(forwardContext);

    try {
      const forwardResponse = await sendPostmarkEmail({
        From: `${forwardContext.fromName} <${forwardContext.fromEmail}>`,
        To: targetEmail,
        Subject: `Fwd: ${forwardContext.sourceSubject || thread.subject || "Inbound message"}`.slice(0, 250),
        TextBody: textBody,
        HtmlBody: htmlBody,
        ReplyTo: forwardContext.fromEmail,
      });
      const sentMessageId = asString(forwardResponse?.MessageID || "");
      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "applied",
            detail: `Forwarded to ${targetEmail}.`,
            payload: { ...payloadForForward, sent_message_id: sentMessageId || null },
            action_type: "forward_email",
            action_key: actionKey,
            decided_at: nowIso,
            applied_at: nowIso,
            updated_at: nowIso,
            error: null,
          })
          .eq("id", actionRecord.id);
      } else {
        await serviceClient.from("thread_actions").insert({
          user_id: supabaseUserId,
          workspace_id: scope.workspaceId ?? null,
          thread_id: thread.id,
          action_type: "forward_email",
          action_key: actionKey,
          status: "applied",
          detail: `Forwarded to ${targetEmail}.`,
          payload: { ...payloadForForward, sent_message_id: sentMessageId || null },
          source: "manual_approval",
          error: null,
          decided_at: nowIso,
          applied_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
      await serviceClient.from("agent_logs").insert({
        draft_id: null,
        step_name: "forward_email_applied",
        step_detail: JSON.stringify({
          thread_id: threadId,
          target_email: targetEmail,
          provider_message_id: sentMessageId || null,
          source_message_id: forwardContext.providerMessageId || null,
        }),
        status: "success",
        created_at: nowIso,
      });
      return NextResponse.json(
        {
          ok: true,
          decision: "accepted",
          action: "forward_email",
          forwarded_to: targetEmail,
          provider_message_id: sentMessageId || null,
          sourceStep: proposalStepName,
        },
        { status: 200 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forwarding failed.";
      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "failed",
            detail: `Forwarding to ${targetEmail} failed.`,
            payload: payloadForForward,
            action_type: "forward_email",
            action_key: actionKey,
            decided_at: nowIso,
            updated_at: nowIso,
            error: message,
          })
          .eq("id", actionRecord.id);
      }
      await serviceClient.from("agent_logs").insert({
        draft_id: null,
        step_name: "forward_email_failed",
        step_detail: JSON.stringify({
          thread_id: threadId,
          target_email: targetEmail,
          reason: message,
        }),
        status: "error",
        created_at: nowIso,
      });
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const fallbackOrderNumber =
    extractOrderNumber(detailText) ||
    extractOrderNumber(thread.subject) ||
    extractOrderNumber(thread.snippet);
  const orderNumber = parsed?.orderNumber || fallbackOrderNumber || null;

  let shopQuery = serviceClient
    .from("shops")
    .select("id, shop_domain, access_token_encrypted")
    .eq("platform", "shopify")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  shopQuery = applyScope(shopQuery, scope, {
    workspaceColumn: "workspace_id",
    userColumn: "owner_user_id",
  });
  const { data: shopRow, error: shopError } = await shopQuery.maybeSingle();
  if (shopError || !shopRow) {
    return NextResponse.json({ error: "Shopify is not connected." }, { status: 400 });
  }

  const domain = normalizeDomain(shopRow?.shop_domain || "");
  if (!domain || !shopRow?.access_token_encrypted) {
    return NextResponse.json(
      { error: "Shopify credentials are incomplete. Reconnect Shopify." },
      { status: 400 }
    );
  }

  let accessToken = "";
  try {
    accessToken = decryptString(shopRow.access_token_encrypted);
  } catch (error) {
    return NextResponse.json(
      { error: `Could not decrypt Shopify token: ${error.message}` },
      { status: 500 }
    );
  }

  const order = await resolveOrder({
    domain,
    token: accessToken,
    orderId: parsed?.orderId,
    orderNumber,
  });
  if (!order?.id) {
    return NextResponse.json(
      { error: "Could not resolve Shopify order for this request." },
      { status: 404 }
    );
  }

  let payloadForExecution =
    parsed?.payload && typeof parsed.payload === "object" ? { ...parsed.payload } : {};
  if (payloadOverride && Object.keys(payloadOverride).length) {
    payloadForExecution = {
      ...payloadForExecution,
      ...payloadOverride,
    };
  }
  if (
    normalizedActionType === "update_shipping_address" &&
    !payloadForExecution?.shipping_address &&
    !payloadForExecution?.shippingAddress
  ) {
    const proposedAddress = parseAddressFromText(detailText);
    if (proposedAddress) {
      payloadForExecution = {
        ...payloadForExecution,
        shipping_address: {
          ...(order.shipping_address || {}),
          ...proposedAddress,
        },
      };
    }
  }

  if (workspaceTestSettings.testMode) {
    const nowIso = new Date().toISOString();
    const actionKey = actionRecord?.action_key
      ? String(actionRecord.action_key)
      : buildActionKey(normalizedActionType, order.id, payloadForExecution);
    const testModeMessage =
      "Action approved, but no changes were made because Test Mode is enabled.";
    const actionRowPayload =
      payloadForExecution && typeof payloadForExecution === "object"
        ? { ...payloadForExecution, simulated: true, test_mode: true }
        : { simulated: true, test_mode: true };

    if (actionRecord?.id) {
      await serviceClient
        .from("thread_actions")
        .update({
          status: "approved_test_mode",
          detail: detailText || actionRecord?.detail || null,
          payload: actionRowPayload,
          action_type: normalizedActionType,
          action_key: actionKey,
          order_id: String(order.id),
          order_number: order.order_number ? String(order.order_number) : null,
          decided_at: nowIso,
          updated_at: nowIso,
          error: testModeMessage,
        })
        .eq("id", actionRecord.id);
    } else {
      await serviceClient.from("thread_actions").insert({
        user_id: supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        thread_id: thread.id,
        action_type: normalizedActionType,
        action_key: actionKey,
        status: "approved_test_mode",
        detail: detailText || null,
        payload: actionRowPayload,
        order_id: String(order.id),
        order_number: order.order_number ? String(order.order_number) : null,
        decided_at: nowIso,
        applied_at: null,
        updated_at: nowIso,
        created_at: nowIso,
        source: "manual_approval",
        error: testModeMessage,
      });
    }

    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: "shopify_action_approved_test_mode",
      step_detail: JSON.stringify({
        thread_id: threadId,
        action: normalizedActionType,
        order_id: String(order.id),
        order_number: order.order_number ?? null,
        detail: detailText || null,
        message: testModeMessage,
      }),
      status: "info",
      created_at: nowIso,
    });

    return NextResponse.json(
      {
        ok: true,
        decision: "accepted",
        simulated: true,
        testMode: true,
        message: testModeMessage,
        approvedAt: nowIso,
        action: normalizedActionType,
        orderId: String(order.id),
        orderNumber: order.order_number ?? null,
        detail: detailText || null,
        sourceStep: proposalStepName,
      },
      { status: 200 }
    );
  }

  const blockedReason = isOrderMutationBlocked(order, normalizedActionType);
  if (blockedReason) {
    const nowIso = new Date().toISOString();
    const actionKey = actionRecord?.action_key
      ? String(actionRecord.action_key)
      : buildActionKey(normalizedActionType, order.id, payloadForExecution);
    const blockedActionDetail = buildBlockedActionDetail(
      normalizedActionType,
      blockedReason
    );

    let latestInboundText = "";
    let latestInboundSubject = thread.subject || "";
    let latestInboundName = "";
    let messageQuery = serviceClient
      .from("mail_messages")
      .select("body_text, body_html, subject, from_name")
      .eq("thread_id", thread.id)
      .eq("from_me", false)
      .order("received_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    messageQuery = applyScope(messageQuery, scope);
    const { data: inboundRow } = await messageQuery.maybeSingle();
    latestInboundText = asString(inboundRow?.body_text) || asString(inboundRow?.body_html) || "";
    latestInboundSubject = asString(inboundRow?.subject) || latestInboundSubject;
    latestInboundName = asString(inboundRow?.from_name) || "";
    const firstName = latestInboundName ? latestInboundName.split(/\s+/)[0] : "";

    let generatedDraftText = null;
    try {
      generatedDraftText = await generateBlockedActionDraft({
        actionType: normalizedActionType,
        blockedReason,
        customerFirstName: firstName,
        customerMessage: latestInboundText,
        orderName: asString(order?.name) || asString(order?.order_number),
      });
      if (draftImpliesCompletedAction(generatedDraftText, normalizedActionType)) {
        generatedDraftText = await generateBlockedActionDraft({
          actionType: normalizedActionType,
          blockedReason,
          customerFirstName: firstName,
          customerMessage: `${latestInboundText}\n\nIMPORTANT: The requested operation was NOT completed. Reply must explicitly state this.`,
          orderName: asString(order?.name) || asString(order?.order_number),
        });
      }
    } catch (error) {
      console.warn("order-updates/accept: blocked draft generation failed", error?.message || error);
    }

    if (generatedDraftText) {
      try {
        await upsertThreadDraft({
          serviceClient,
          scope,
          thread,
          bodyText: generatedDraftText,
          subject: latestInboundSubject || thread.subject || "Re:",
        });
      } catch (error) {
        console.warn("order-updates/accept: blocked draft upsert failed", error?.message || error);
      }
    }

    if (actionRecord?.id) {
      await serviceClient
        .from("thread_actions")
        .update({
          status: "failed",
          detail: blockedActionDetail,
          payload: payloadForExecution,
          action_type: normalizedActionType,
          action_key: actionKey,
          order_id: String(order.id),
          order_number: order.order_number ? String(order.order_number) : null,
          decided_at: nowIso,
          updated_at: nowIso,
          error: blockedReason,
        })
        .eq("id", actionRecord.id);
    } else {
      await serviceClient.from("thread_actions").insert({
        user_id: supabaseUserId,
        workspace_id: scope.workspaceId ?? null,
        thread_id: thread.id,
        action_type: normalizedActionType,
        action_key: actionKey,
        status: "failed",
        detail: blockedActionDetail,
        payload: payloadForExecution,
        order_id: String(order.id),
        order_number: order.order_number ? String(order.order_number) : null,
        decided_at: nowIso,
        updated_at: nowIso,
        created_at: nowIso,
        source: "manual_approval",
        error: blockedReason,
      });
    }

    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: "shopify_action_blocked",
      step_detail: JSON.stringify({
        thread_id: threadId,
        action: normalizedActionType,
        order_id: String(order.id),
        order_number: order.order_number ?? null,
        detail: blockedActionDetail,
        reason: blockedReason,
      }),
      status: "warning",
      created_at: nowIso,
    });

    return NextResponse.json(
      {
        ok: true,
        blocked: true,
        applied: false,
        action: normalizedActionType,
        orderId: String(order.id),
        orderNumber: order.order_number ?? null,
        reason: blockedReason,
        draftGenerated: Boolean(generatedDraftText),
      },
      { status: 200 }
    );
  }

  let updateResult = null;
  try {
    updateResult = await executeShopifyAction({
      domain,
      token: accessToken,
      actionType: normalizedActionType,
      orderId: Number(order.id),
      payload: payloadForExecution,
      order,
    });
  } catch (error) {
    const statusCode = Number(error?.status || 400);
    const message =
      (error instanceof Error ? error.message : String(error || "")) ||
      "Could not execute Shopify action.";
    return NextResponse.json({ error: message }, { status: statusCode });
  }

  if (!updateResult.response.ok) {
    const payload = updateResult.payload || {};
    const rawMessage =
      payload?.errors ||
      payload?.error ||
      payload?.message ||
      `Shopify returned ${updateResult.response.status}.`;
    const statusCode = Number(updateResult?.response?.status || 500);

    if (normalizedActionType === "resend_confirmation_or_invoice" && statusCode === 406) {
      const friendlyReason =
        "Shopify accepterede ikke automatisk gensendelse af faktura/kvittering for denne ordre. Send den manuelt fra Shopify admin.";
      const nowIso = new Date().toISOString();
      const actionKey = actionRecord?.action_key
        ? String(actionRecord.action_key)
        : buildActionKey(normalizedActionType, order.id, payloadForExecution);
      const failedActionDetail = "Could not resend confirmation/invoice automatically.";

      let latestInboundText = "";
      let latestInboundSubject = thread.subject || "";
      let latestInboundName = "";
      let messageQuery = serviceClient
        .from("mail_messages")
        .select("body_text, body_html, subject, from_name")
        .eq("thread_id", thread.id)
        .eq("from_me", false)
        .order("received_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1);
      messageQuery = applyScope(messageQuery, scope);
      const { data: inboundRow } = await messageQuery.maybeSingle();
      latestInboundText = asString(inboundRow?.body_text) || asString(inboundRow?.body_html) || "";
      latestInboundSubject = asString(inboundRow?.subject) || latestInboundSubject;
      latestInboundName = asString(inboundRow?.from_name) || "";
      const firstName = latestInboundName ? latestInboundName.split(/\s+/)[0] : "";

      let generatedDraftText = null;
      try {
        generatedDraftText = await generateBlockedActionDraft({
          actionType: normalizedActionType,
          blockedReason: friendlyReason,
          customerFirstName: firstName,
          customerMessage: latestInboundText,
          orderName: asString(order?.name) || asString(order?.order_number),
        });
        if (generatedDraftText) {
          await upsertThreadDraft({
            serviceClient,
            scope,
            thread,
            bodyText: generatedDraftText,
            subject: latestInboundSubject || thread.subject || "Order support",
          });
        }
      } catch (error) {
        console.warn(
          "order-updates/accept: failed to generate fallback draft after Shopify 406",
          error?.message || error
        );
      }

      if (actionRecord?.id) {
        await serviceClient
          .from("thread_actions")
          .update({
            status: "failed",
            detail: failedActionDetail,
            payload: payloadForExecution,
            action_type: normalizedActionType,
            action_key: actionKey,
            order_id: String(order.id),
            order_number: order.order_number ? String(order.order_number) : null,
            decided_at: nowIso,
            updated_at: nowIso,
            error: friendlyReason,
          })
          .eq("id", actionRecord.id);
      } else {
        await serviceClient.from("thread_actions").insert({
          user_id: supabaseUserId,
          workspace_id: scope.workspaceId ?? null,
          thread_id: thread.id,
          action_type: normalizedActionType,
          action_key: actionKey,
          status: "failed",
          detail: failedActionDetail,
          payload: payloadForExecution,
          order_id: String(order.id),
          order_number: order.order_number ? String(order.order_number) : null,
          decided_at: nowIso,
          updated_at: nowIso,
          created_at: nowIso,
          source: "manual_approval",
          error: friendlyReason,
        });
      }

      await serviceClient.from("agent_logs").insert({
        draft_id: null,
        step_name: "shopify_action_failed",
        step_detail: JSON.stringify({
          thread_id: threadId,
          action: normalizedActionType,
          order_id: String(order.id),
          order_number: order.order_number ?? null,
          detail: failedActionDetail,
          status_code: statusCode,
          reason: friendlyReason,
          raw: String(rawMessage || ""),
        }),
        status: "warning",
        created_at: nowIso,
      });

      return NextResponse.json(
        {
          ok: true,
          blocked: true,
          applied: false,
          action: normalizedActionType,
          orderId: String(order.id),
          orderNumber: order.order_number ?? null,
          reason: friendlyReason,
          detail: failedActionDetail,
          draftGenerated: Boolean(generatedDraftText),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: String(rawMessage) }, { status: statusCode });
  }

  let webshipperSync = null;
  const webshipperSyncedActions = new Set(["update_shipping_address", "cancel_order"]);
  if (webshipperSyncedActions.has(normalizedActionType)) {
    try {
      webshipperSync = await syncWebshipperAction({
        serviceClient,
        scope,
        actionType: normalizedActionType,
        shopifyOrder: order,
        payload: payloadForExecution,
      });
    } catch (error) {
      webshipperSync = {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: "shopify_action_applied",
    step_detail: JSON.stringify({
      thread_id: threadId,
      action: normalizedActionType,
      order_id: String(order.id),
      order_number: order.order_number ?? null,
      detail: detailText || null,
      webshipper_sync: webshipperSync,
    }),
    status: "success",
    created_at: new Date().toISOString(),
  });

  const nowIso = new Date().toISOString();
  const actionKey = actionRecord?.action_key
    ? String(actionRecord.action_key)
    : buildActionKey(normalizedActionType, order.id, payloadForExecution);
  const executionPayload =
    updateResult?.payload && typeof updateResult.payload === "object" ? updateResult.payload : {};
  const actionRowPayload =
    payloadForExecution && typeof payloadForExecution === "object"
      ? {
          ...payloadForExecution,
          ...(Object.keys(executionPayload).length ? { execution_result: executionPayload } : {}),
          ...(asString(executionPayload?.return_id)
            ? { return_id: asString(executionPayload.return_id) }
            : {}),
          ...(typeof executionPayload?.auto_processed === "boolean"
            ? { auto_processed: executionPayload.auto_processed }
            : {}),
        }
      : parsed?.payload && typeof parsed.payload === "object"
      ? {
          ...parsed.payload,
          ...(Object.keys(executionPayload).length ? { execution_result: executionPayload } : {}),
          ...(asString(executionPayload?.return_id)
            ? { return_id: asString(executionPayload.return_id) }
            : {}),
          ...(typeof executionPayload?.auto_processed === "boolean"
            ? { auto_processed: executionPayload.auto_processed }
            : {}),
        }
      : {};

  if (actionRecord?.id) {
    await serviceClient
      .from("thread_actions")
      .update({
        status: "applied",
        detail: detailText || actionRecord?.detail || null,
        payload: actionRowPayload,
        action_type: normalizedActionType,
        action_key: actionKey,
        order_id: String(order.id),
        order_number: order.order_number ? String(order.order_number) : null,
        decided_at: nowIso,
        applied_at: nowIso,
        updated_at: nowIso,
        error: null,
      })
      .eq("id", actionRecord.id);
  } else {
    await serviceClient.from("thread_actions").insert({
      user_id: supabaseUserId,
      workspace_id: scope.workspaceId ?? null,
      thread_id: thread.id,
      action_type: normalizedActionType,
      action_key: actionKey,
      status: "applied",
      detail: detailText || null,
      payload: actionRowPayload,
      order_id: String(order.id),
      order_number: order.order_number ? String(order.order_number) : null,
      decided_at: nowIso,
      applied_at: nowIso,
      updated_at: nowIso,
      created_at: nowIso,
      source: "manual_approval",
      error: null,
    });
  }

  let followUpAction = null;
  if (normalizedActionType === "create_exchange_request") {
    const returnId = asString(actionRowPayload?.return_id);
    const autoProcessed = actionRowPayload?.auto_processed === true;
    if (returnId && !autoProcessed) {
      const recommendation = inferRestockRecommendation({
        payload: actionRowPayload,
        detailText,
      });
      const processPayload = {
        return_id: returnId,
        restock: recommendation.restock,
        restock_reason: recommendation.reason,
        restock_confidence: recommendation.confidence,
        ai_suggested_restock: recommendation.restock,
      };
      const processActionType = "process_exchange_return";
      const processActionKey = buildActionKey(processActionType, order.id, { return_id: returnId });
      let existingProcessActionQuery = serviceClient
        .from("thread_actions")
        .select("id, status, action_type, detail, payload, created_at")
        .eq("thread_id", thread.id)
        .eq("action_key", processActionKey)
        .order("updated_at", { ascending: false })
        .limit(1);
      existingProcessActionQuery = applyScope(existingProcessActionQuery, scope);
      const { data: existingProcessAction } = await existingProcessActionQuery.maybeSingle();
      const existingProcessStatus = normalizeActionStatus(existingProcessAction?.status || "");
      if (existingProcessAction?.id && existingProcessStatus === "pending") {
        followUpAction = {
          id: String(existingProcessAction.id),
          actionType: asString(existingProcessAction.action_type),
          detail: asString(existingProcessAction.detail),
          status: asString(existingProcessAction.status),
          payload:
            existingProcessAction.payload && typeof existingProcessAction.payload === "object"
              ? existingProcessAction.payload
              : {},
          createdAt: existingProcessAction.created_at || nowIso,
        };
      } else {
        const processDetail = `Process return in Shopify for ${returnId}. AI foreslår restock: ${
          recommendation.restock ? "Ja" : "Nej"
        } (${recommendation.confidence}).`;
        const { data: insertedProcessAction } = await serviceClient
          .from("thread_actions")
          .insert({
            user_id: supabaseUserId,
            workspace_id: scope.workspaceId ?? null,
            thread_id: thread.id,
            action_type: processActionType,
            action_key: processActionKey,
            status: "pending",
            detail: processDetail,
            payload: processPayload,
            order_id: String(order.id),
            order_number: order.order_number ? String(order.order_number) : null,
            decided_at: null,
            applied_at: null,
            updated_at: nowIso,
            created_at: nowIso,
            source: "manual_approval",
            error: null,
          })
          .select("id, action_type, detail, status, payload, created_at")
          .maybeSingle();
        if (insertedProcessAction?.id) {
          followUpAction = {
            id: String(insertedProcessAction.id),
            actionType: asString(insertedProcessAction.action_type),
            detail: asString(insertedProcessAction.detail),
            status: asString(insertedProcessAction.status),
            payload:
              insertedProcessAction.payload && typeof insertedProcessAction.payload === "object"
                ? insertedProcessAction.payload
                : {},
            createdAt: insertedProcessAction.created_at || nowIso,
          };
        }
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      decision: "accepted",
      approvedAt: nowIso,
      action: normalizedActionType,
      orderId: String(order.id),
      orderNumber: order.order_number ?? null,
      detail: detailText || null,
      sourceStep: proposalStepName,
      webshipperSync,
      followUpAction,
    },
    { status: 200 }
  );
}
