import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { SupabaseKnowledgeStore } from "../knowledge";
import { Ship24ReadOnlyProvider } from "../ship24-read-only";
import { ShopifyReadOnlyProvider } from "../shopify-read-only";

const DEV_WORKSPACE_ID = "7be64848-c58a-4653-8a9a-21c1c9b2f497";
const DEV_STORE_DOMAIN = "test-app-store-ai-mailer.myshopify.com";
const RUN_REAL_EVAL = process.env.GREENFIELD_SHIP24_REAL_EVAL === "1";

function loadEnvFile(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const rawValue = match[2].trim();
    process.env[match[1]] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
}

function decryptShopifyToken(payload, encodedKey) {
  const key = Buffer.from(encodedKey, "base64");
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(12, data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function safeText(value) {
  return String(value ?? "").trim();
}

function mask(value) {
  const raw = safeText(value);
  if (!raw) return null;
  return "[redacted]";
}

function maskMessage(value, sensitiveValues = []) {
  let result = safeText(value)
    .replace(/Sofie Bruun/gi, "[name redacted]")
    .replace(/\bJonas\b/gi, "[name redacted]")
    .replace(/\b\d{10,22}\b/g, "[tracking redacted]")
    .replace(/\b(?:GLS|BRING|POSTNORD|DAO|DHL|UPS)[A-Z0-9_-]{5,}\b/gi, "[tracking redacted]");
  for (const sensitive of sensitiveValues.filter(Boolean)) result = result.split(sensitive).join("[tracking redacted]");
  return result;
}

function orderSummary(order) {
  if (!order) return null;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    items: (order.items ?? []).map(({ title, quantity }) => ({ title, quantity })),
    fulfillments: (order.fulfillments ?? []).map((fulfillment) => ({
      status: fulfillment.status,
      carrier: fulfillment.carrier,
      trackingNumber: mask(fulfillment.trackingNumber),
      trackingAvailable: Boolean(fulfillment.trackingNumber || fulfillment.trackingUrl),
    })),
  };
}

function safeResult(result, trackingNumbers) {
  const value = JSON.parse(JSON.stringify(result ?? null));
  const redact = (item) => {
    if (typeof item === "string") return maskMessage(item, trackingNumbers);
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, redact(child)]));
    return item;
  };
  return redact(value);
}

async function shopifyContext(supabase, accessToken, subject, orderNumber) {
  const { data: threads, error } = await supabase
    .from("mail_threads")
    .select("id, subject, customer_email, customer_name")
    .eq("workspace_id", DEV_WORKSPACE_ID)
    .eq("subject", subject)
    .limit(20);
  if (error) throw new Error(`Thread lookup failed: ${error.message}`);
  for (const thread of threads ?? []) {
    if (!thread.customer_email) continue;
    const commerce = new ShopifyReadOnlyProvider({
      shopDomain: DEV_STORE_DOMAIN,
      accessToken,
      customer: { email: thread.customer_email, name: thread.customer_name },
    });
    const order = orderNumber ? await commerce.getOrder(orderNumber) : null;
    if (orderNumber && !order) continue;
    return { thread, commerce, order };
  }
  throw new Error(`No usable Test thread found for ${subject}.`);
}

async function messageForThread(supabase, threadId, fallback) {
  const { data } = await supabase
    .from("mail_messages")
    .select("body_text, clean_body_text, from_me, received_at, created_at")
    .eq("thread_id", threadId)
    .eq("from_me", false)
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return safeText(data?.clean_body_text || data?.body_text) || fallback;
}

function summarizeTrace(trace, trackingNumbers) {
  return trace.events
    .filter((event) => event.type === "tool_call" || event.type === "tool_result" || event.type === "error")
    .map((event) => {
      const data = event.data ?? {};
      if (event.type === "tool_call") return { type: event.type, name: data.name, arguments: safeResult(data.arguments, trackingNumbers) };
      if (event.type === "error") return { type: event.type, data: safeResult(data, trackingNumbers) };
      const result = data.result ?? {};
      const resultData = result.data ?? {};
      if (data.name === "get_order") return { type: event.type, name: data.name, status: result.status, data: orderSummary(resultData), error: result.error ?? null };
      if (data.name === "get_tracking") {
        const live = resultData.live_tracking;
        return {
          type: event.type,
          name: data.name,
          status: result.status,
          trackingIdentifier: safeResult(resultData.tracking_identifier, trackingNumbers),
          liveTracking: live ? {
            provider: live.provider,
            source: live.source,
            carrier: live.carrier,
            status: live.status,
            subStatus: live.subStatus,
            latestEvent: live.latestEvent,
            estimatedDelivery: live.estimatedDelivery,
            checkpointCount: Array.isArray(live.checkpoints) ? live.checkpoints.length : 0,
            exception: live.exception,
            observedAt: live.observedAt,
          } : null,
          error: result.error ?? null,
        };
      }
      if (data.name === "get_order_history") return {
        type: event.type,
        name: data.name,
        status: result.status,
        orderCount: Array.isArray(resultData.orders) ? resultData.orders.length : 0,
        candidateOnly: resultData.candidate_only ?? false,
        hasOrderHistory: resultData.has_order_history ?? null,
        error: result.error ?? null,
      };
      if (data.name === "inspect_fulfillment") return { type: event.type, name: data.name, status: result.status, data: safeResult(resultData, trackingNumbers), error: result.error ?? null };
      return { type: event.type, name: data.name, status: result.status, data: safeResult(resultData, trackingNumbers) };
    });
}

function structuredResponseSummary(trace, trackingNumbers) {
  const finalEvent = trace.events.find((event) => event.type === "final_response");
  return {
    rawSegments: safeResult(finalEvent?.data?.structured_response ?? null, trackingNumbers),
    validation: safeResult(finalEvent?.data?.validation ?? null, trackingNumbers),
  };
}

function capabilityManifest(trace) {
  const started = trace.events.find((event) => event.type === "agent_started");
  return started?.data?.capability_manifest ?? null;
}

describe("greenfield Ship24 real DEV evaluation", () => {
  const test = RUN_REAL_EVAL ? it : it.skip;

  test("runs direct Ship24 checks before the same one-agent WISMO slice", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    expect(supabaseUrl).toBeTruthy();
    expect(serviceRoleKey).toBeTruthy();
    expect(anonKey).toBeTruthy();
    expect(encryptionKey).toBeTruthy();

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: shop, error: shopError } = await supabase
      .from("shops")
      .select("shop_domain, access_token_encrypted")
      .eq("workspace_id", DEV_WORKSPACE_ID)
      .eq("shop_domain", DEV_STORE_DOMAIN)
      .eq("platform", "shopify")
      .is("uninstalled_at", null)
      .maybeSingle();
    if (shopError) throw new Error(`Shop lookup failed: ${shopError.message}`);
    expect(shop?.shop_domain).toBe(DEV_STORE_DOMAIN);
    const accessToken = decryptShopifyToken(shop.access_token_encrypted, encryptionKey);

    const directCases = [
      { subject: "Ordre 1051", orderNumber: "1051" },
      { subject: "Hvor er min pakke?", orderNumber: "1054" },
      { subject: "Hvor er min ordre #1063?", orderNumber: "1063" },
    ];
    const proxyUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/fetch-tracking`;
    const requestViaDevShip24 = async (trackingNumber) => {
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`DEV tracking function returned ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    };

    const directResults = [];
    const trackingNumbers = [];
    for (const item of directCases) {
      const context = await shopifyContext(supabase, accessToken, item.subject, item.orderNumber);
      const fulfillment = context.order.fulfillments?.find((candidate) => candidate.trackingNumber || candidate.trackingUrl);
      expect(fulfillment?.trackingNumber).toBeTruthy();
      trackingNumbers.push(fulfillment.trackingNumber);
      const provider = new Ship24ReadOnlyProvider({ requestImpl: requestViaDevShip24, now: () => new Date().toISOString() });
      const result = await provider.lookup({
        trackingNumber: fulfillment.trackingNumber,
        carrierHint: fulfillment.carrier,
        trackingUrl: fulfillment.trackingUrl,
        provenance: { source: "shopify_order_fulfillment", workspaceId: DEV_WORKSPACE_ID, orderNumber: context.order.orderNumber, orderId: context.order.id, fulfillmentId: fulfillment.id },
      });
      directResults.push({
        order: orderSummary(context.order),
        ship24Result: safeResult(result, trackingNumbers),
      });
    }

    const caseDefinitions = [
      {
        subject: "Ordre 1051",
        fallback: "Hej\n\nHvor er min ordre 1051?\n\nMvh Jonas",
      },
      {
        subject: "Hvor er min pakke?",
        fallback: "Hej\n\nJeg bestilte et headset i sidste uge, ordre #1054. Kan I sige mig hvor den er henne?\n\nMvh Jonas",
      },
      {
        subject: "Kan I vente med at sende resten",
        fallback: "Hej\n\nJeg er bortrejst i to uger. Kan I vente med at sende resten af ordre #1055 til jeg er hjemme igen?\n\nMvh Jonas",
      },
      {
        subject: "Ordre 9999",
        fallback: "Hej\n\nHvor er min ordre #9999? Den skulle være kommet for en uge siden.\n\nMvh Jonas",
      },
      {
        subject: "Hvor er min ordre #1063?",
        fallback: "Hej\n\nJeg afgav ordre #1063 og har fået et trackingnummer, men når jeg slår det op sker der ikke rigtig noget.\n\nKan I se hvor pakken befinder sig, og hvornår jeg kan forvente at få den? Jeg skal bruge den i weekenden.\n\nHilsen\nSofie Bruun",
      },
      {
        subject: "Ordre 1058",
        fallback: "Hej\n\nJeg vil gerne høre status på ordre #1058, og hvilken adresse den bliver sendt til.\n\nMvh Jonas",
      },
    ];

    const knowledge = new SupabaseKnowledgeStore(supabase);
    const cases = [];
    for (const definition of caseDefinitions) {
      const orderNumber = definition.subject === "Ordre 1051" ? "1051"
        : definition.subject === "Hvor er min pakke?" ? "1054"
          : definition.subject === "Kan I vente med at sende resten" ? "1055"
          : definition.subject === "Hvor er min ordre #1063?" ? "1063"
            : definition.subject === "Ordre 1058" ? "1058"
              : null;
      const context = await shopifyContext(supabase, accessToken, definition.subject, orderNumber === "1054" || orderNumber === "1055" ? orderNumber : null);
      const message = await messageForThread(supabase, context.thread.id, definition.fallback);
      const tenant = { workspaceId: DEV_WORKSPACE_ID, shopId: shop.id ?? null, customerEmail: context.thread.customer_email, customerName: context.thread.customer_name ?? null };
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant,
        message,
        capabilities: {
          tenant,
          knowledge,
          commerce: context.commerce,
          tracking: new Ship24ReadOnlyProvider({ requestImpl: requestViaDevShip24 }),
        },
        maxTurns: 8,
      });
      const referencedOrder = orderNumber ? await context.commerce.getOrder(orderNumber) : null;
      const structured = structuredResponseSummary(run.trace, trackingNumbers);
      cases.push({
        customerMessage: maskMessage(message, trackingNumbers),
        availableCapabilities: capabilityManifest(run.trace),
        verifiedShopifyOrder: orderSummary(referencedOrder),
        trace: summarizeTrace(run.trace, trackingNumbers),
        rawStructuredSegments: structured.rawSegments,
        responseValidation: structured.validation,
        finalResponse: maskMessage(run.response, trackingNumbers),
      });
    }

    console.log("GREENFIELD_SHIP24_REAL_DEV_EVAL");
    console.log(JSON.stringify({
      source: { supabase: "DEV", workspace: "Test", shop: DEV_STORE_DOMAIN, ship24Transport: "DEV fetch-tracking Edge Function with Ship24 fallback", noAceZone: true },
      directResults,
      cases,
    }, null, 2));
  }, 300_000);
});
