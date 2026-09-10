import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runGreenfieldAgentWithAgentsSdk } from "../agents-sdk";
import { SupabaseKnowledgeStore } from "../knowledge";
import { Ship24ReadOnlyProvider } from "../ship24-read-only";
import { ShopifyReadOnlyProvider } from "../shopify-read-only";

const RUN_BASELINE = process.env.GREENFIELD_BROAD_BASELINE === "1";

const SONA_WORKSPACE_ID = "48d4d494-b09c-49ba-920c-b9441204b87f";
const TEST_WORKSPACE_ID = "7be64848-c58a-4653-8a9a-21c1c9b2f497";
const TEST_STORE_DOMAIN = "test-app-store-ai-mailer.myshopify.com";
const DEV_SUPABASE_REF = "zxaoycxzdjrbnzvbullk";
const ARTIFACT_PATH = "/tmp/greenfield-broad-support-quality-baseline.json";

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

function text(value) {
  return String(value ?? "").trim();
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

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function maskString(value, sensitiveValues = []) {
  let result = text(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email redacted]")
    .replace(/\b\d{10,22}\b/g, "[identifier redacted]")
    .replace(/\b(?:gid:\/\/shopify\/[^\s,)]+)\b/gi, "[shopify id redacted]")
    .replace(/\bSofie Bruun\b/gi, "[name redacted]")
    .replace(/\bJonas\b/gi, "[name redacted]");
  for (const sensitive of Array.from(sensitiveValues ?? []).filter(Boolean)) {
    result = result.split(String(sensitive)).join("[tracking redacted]");
  }
  return result;
}

function maskValue(value, sensitiveValues = [], key = "") {
  if (/token|secret|password|api_key|encrypted/i.test(key)) return "[secret redacted]";
  if (typeof value === "string") return maskString(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => maskValue(item, sensitiveValues, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, maskValue(child, sensitiveValues, childKey)]));
  }
  return value;
}

function orderSummary(order, sensitiveValues = []) {
  if (!order) return null;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    total: order.total,
    currency: order.currency,
    items: (order.items ?? []).map(({ title, quantity }) => ({ title, quantity })),
    fulfillments: (order.fulfillments ?? []).map((fulfillment) => ({
      status: fulfillment.status,
      carrier: fulfillment.carrier,
      trackingAvailable: Boolean(fulfillment.trackingNumber || fulfillment.trackingUrl),
      trackingNumber: fulfillment.trackingNumber ? maskString(fulfillment.trackingNumber, sensitiveValues) : null,
    })),
  };
}

function unavailableCommerceProvider(reason) {
  return {
    providerName: reason,
    async getOrder() { return null; },
    async getOrderHistory() { return []; },
    async getCustomer() { return null; },
    async getProduct(query) { return { status: "unavailable", query, provider: reason }; },
    async inspectFulfillment(orderId) { return { status: "unavailable", order_id: orderId, provider: reason }; },
  };
}

function toolSequence(trace) {
  return trace.events
    .filter((event) => event.type === "tool_call")
    .map((event) => event.data?.name)
    .filter(Boolean);
}

function knowledgeSummary(result, sensitiveValues) {
  const results = result?.data?.results;
  if (!Array.isArray(results)) return undefined;
  return results.map((item) => ({
    title: item.title,
    knowledge_type: item.knowledge_type,
    authority: item.authority,
    score: item.score,
    rank: item.rank,
    match_reason: item.match_reason,
    provenance: maskValue(item.provenance, sensitiveValues),
    structured_data: maskValue(item.structured_data, sensitiveValues),
    evidence_sections: maskValue(item.evidence_sections, sensitiveValues),
  }));
}

function safeTrace(trace, sensitiveValues) {
  return {
    trace_id: trace.traceId,
    workspace_id: trace.workspaceId,
    started_at: trace.startedAt,
    finished_at: trace.finishedAt,
    usage: maskValue(trace.usage, sensitiveValues),
    events: trace.events.map((event) => {
      if (event.type !== "tool_result") return maskValue(event, sensitiveValues);
      const result = event.data?.result;
      const summarizedKnowledge = knowledgeSummary(result, sensitiveValues);
      if (!summarizedKnowledge) return maskValue(event, sensitiveValues);
      return {
        at: event.at,
        type: event.type,
        data: {
          ...maskValue(event.data, sensitiveValues),
          result: {
            ...maskValue(result, sensitiveValues),
            data: {
              ...maskValue(result?.data, sensitiveValues),
              results: summarizedKnowledge,
            },
          },
        },
      };
    }),
  };
}

function responseFlags(response, tools) {
  const value = text(response);
  const lower = value.toLowerCase();
  return {
    character_count: value.length,
    paragraph_count: value ? value.split(/\n\s*\n/).length : 0,
    bullet_count: (value.match(/^\s*[-*]\s+/gm) ?? []).length,
    robotic_labels: /(?:order reference|order items|financial status|fulfillment status|carrier:|tracking number:|latest tracking event:)/i.test(value),
    mixed_language_marker: /(?:please provide|i can|i could not|status:|carrier:|order reference)/i.test(value) && /[æøå]/i.test(value),
    asks_for_clarification: /\?|please provide|kan du|vil du|hvilken|hvad/i.test(value),
    tool_count: tools.length,
    tool_failure_seen: tools.some((tool) => tool.status && ["error", "unavailable"].includes(tool.status)),
  };
}

function traceToolSummary(trace, sensitiveValues) {
  return trace.events
    .filter((event) => event.type === "tool_call" || event.type === "tool_result" || event.type === "error")
    .map((event) => {
      const data = event.data ?? {};
      if (event.type === "tool_call") return { type: event.type, name: data.name, arguments: maskValue(data.arguments, sensitiveValues) };
      if (event.type === "error") return { type: event.type, data: maskValue(data, sensitiveValues) };
      const result = data.result ?? {};
      const resultData = result.data ?? {};
      if (data.name === "get_order") return { type: event.type, name: data.name, status: result.status, data: orderSummary(resultData, sensitiveValues), error: result.error ?? null };
      if (data.name === "get_order_history") return {
        type: event.type,
        name: data.name,
        status: result.status,
        orderCount: Array.isArray(resultData.orders) ? resultData.orders.length : 0,
        candidateOnly: resultData.candidate_only ?? false,
        hasOrderHistory: resultData.has_order_history ?? null,
        orderNumbers: Array.isArray(resultData.orders) ? resultData.orders.map((order) => order.orderNumber) : [],
        error: result.error ?? null,
      };
      if (data.name === "get_tracking") return {
        type: event.type,
        name: data.name,
        status: result.status,
        trackingIdentifier: maskValue(resultData.tracking_identifier, sensitiveValues),
        liveTracking: resultData.live_tracking ? maskValue({
          provider: resultData.live_tracking.provider,
          source: resultData.live_tracking.source,
          carrier: resultData.live_tracking.carrier,
          status: resultData.live_tracking.status,
          subStatus: resultData.live_tracking.subStatus,
          latestEvent: resultData.live_tracking.latestEvent,
          estimatedDelivery: resultData.live_tracking.estimatedDelivery,
          checkpointCount: Array.isArray(resultData.live_tracking.checkpoints) ? resultData.live_tracking.checkpoints.length : 0,
          exception: resultData.live_tracking.exception,
          observedAt: resultData.live_tracking.observedAt,
        }, sensitiveValues) : null,
        error: result.error ?? null,
      };
      if (data.name === "search_policy" || data.name === "search_product_knowledge" || data.name === "search_procedures" || data.name === "get_brand_guidance" || data.name === "search_historical_cases") {
        return { type: event.type, name: data.name, status: result.status, knowledge: knowledgeSummary(result, sensitiveValues), error: result.error ?? null };
      }
      return { type: event.type, name: data.name, status: result.status, data: maskValue(resultData, sensitiveValues), error: result.error ?? null };
    });
}

function orderNumberFrom(value) {
  const match = text(value).match(/(?:order|ordre)\s*(?:number|no\.?|nr\.?)?\s*#?\s*(\d{3,})|#(\d{3,})/i);
  return match ? (match[1] ?? match[2]) : null;
}

const SINGLE_TURN_CASES = [
  { id: "product_blaze_ps5", category: "PRODUCT", tenant: "sona", message: "Does the A-Blaze work with PlayStation 5?", expectedTools: ["search_product_knowledge"], expectedFacts: ["A-Blaze supports PlayStation 5"] },
  { id: "product_arise_wireless_gaming", category: "PRODUCT", tenant: "sona", message: "Can I use the A-Rise wirelessly for competitive gaming?", expectedTools: ["search_product_knowledge"], expectedFacts: ["Bluetooth is available but not advised for intense competitive gaming"] },
  { id: "product_blaze_earpads", category: "PRODUCT", tenant: "sona", message: "Can I replace the ear pads on my A-Blaze?", expectedTools: ["search_product_knowledge"], expectedFacts: ["ear pads are detachable and replaceable"] },
  { id: "product_spire_app_platforms", category: "PRODUCT", tenant: "sona", message: "Does the A-Spire Wireless work across platforms with the AceZone App?", expectedTools: ["search_product_knowledge"], expectedFacts: ["AceZone App configures the headset across platforms"] },
  { id: "product_blaze_connection", category: "PRODUCT", tenant: "sona", message: "Is the A-Blaze headset wireless or wired, and what connection options does it have?", expectedTools: ["search_product_knowledge"], expectedFacts: ["wireless dongle", "USB-C cable", "Bluetooth 5.4"] },
  { id: "product_arise_bluetooth", category: "PRODUCT", tenant: "sona", message: "What can I use A-Rise Bluetooth for, and is it suitable for gaming?", expectedTools: ["search_product_knowledge"], expectedFacts: ["wireless listening is possible", "wired use is designed for gaming"] },

  { id: "stock_chaos_headset", category: "STOCK", tenant: "test", contextSubject: "Ordre 1051", message: "Is Chaos Headset 4 currently in stock?", expectedTools: ["get_product"], expectedFacts: ["do not infer stock from product existence"] },
  { id: "stock_chaos_mic", category: "STOCK", tenant: "test", contextSubject: "Kan I vente med at sende resten", message: "Can I buy Chaos Mic 6 right now?", expectedTools: ["get_product"], expectedFacts: ["inventory is not verified unless explicitly returned"] },
  { id: "stock_chaos_product_exists", category: "STOCK", tenant: "test", contextSubject: "Ordre 1051", message: "Do you have the product Chaos Headset 4?", expectedTools: ["get_product"], expectedFacts: ["product record may exist; stock remains unverified"] },
  { id: "stock_unknown_product", category: "STOCK", tenant: "test", contextSubject: "Ordre 1051", message: "Is an item called No Such Chaos 999 available?", expectedTools: ["get_product"], expectedFacts: ["unknown product must not be claimed available"] },

  { id: "return_sealed_within_window", category: "RETURNS", tenant: "sona", message: "I received my AceZone headset 20 days ago, it is still sealed and unused. Can I return it?", expectedTools: ["search_policy"], expectedFacts: ["30-day money-back guarantee", "sealed and unused"] },
  { id: "return_opened_within_window", category: "RETURNS", tenant: "sona", message: "I received my headset 20 days ago and opened the packaging, but it is otherwise complete. Can I return it?", expectedTools: ["search_policy"], expectedFacts: ["return can still be honored", "value reduction may apply"] },
  { id: "return_outside_window", category: "RETURNS", tenant: "sona", message: "I received my headset 45 days ago and want to return it unused. Is that within policy?", expectedTools: ["search_policy"], expectedFacts: ["30-day window", "do not promise eligibility"] },
  { id: "return_missing_order", category: "RETURNS", tenant: "sona", message: "I want to return my headset but I do not have the order number. What do you need from me?", expectedTools: ["search_policy"], expectedFacts: ["order number and name used at purchase are requested"] },
  { id: "return_not_intact", category: "RETURNS", tenant: "sona", message: "Can I return my headset if I bought it from AceZone.io and the packaging is not intact?", expectedTools: ["search_policy"], expectedFacts: ["inspection and possible deduction", "do not overstate acceptance"] },
  { id: "return_opened_refund", category: "RETURNS", tenant: "sona", message: "Can I return an opened headset after 10 days, and how would the refund be handled?", expectedTools: ["search_policy"], expectedFacts: ["opened return may be honored", "refund can reflect reduced value"] },

  { id: "refund_timing", category: "REFUNDS", tenant: "sona", message: "How long after you process my return should the refund take?", expectedTools: ["search_policy"], expectedFacts: ["refund initiated after return is received and processed"] },
  { id: "refund_opened_amount", category: "REFUNDS", tenant: "sona", message: "If I opened the package, will I get the full purchase amount back?", expectedTools: ["search_policy"], expectedFacts: ["reduced value may be deducted", "not a guaranteed full refund"] },
  { id: "refund_shipping_cost", category: "REFUNDS", tenant: "sona", message: "Does the 30-day refund include the cost of shipping the order back?", expectedTools: ["search_policy"], expectedFacts: ["return shipping cost is not included"] },
  { id: "refund_request_without_order", category: "REFUNDS", tenant: "sona", message: "Please refund my order now. I have not provided an order number.", expectedTools: ["search_policy"], expectedFacts: ["policy does not execute a refund", "do not promise an action"] },

  { id: "wismo_1063", category: "WISMO", tenant: "test", contextSubject: "Hvor er min ordre #1063?", orderNumber: "1063", message: "Jeg vil gerne vide hvor min ordre #1063 er, og hvornår den kommer.", expectedTools: ["get_order", "get_tracking"], expectedFacts: ["Shopify order 1063", "verified Ship24 status"] },
  { id: "wismo_1054_tracking_missing", category: "WISMO", tenant: "test", contextSubject: "Hvor er min pakke?", orderNumber: "1054", message: "My order #1054 has shipped but tracking shows nothing. Can you check it?", expectedTools: ["get_order", "get_tracking"], expectedFacts: ["Shopify fulfillment exists", "Ship24 may return not_found"] },
  { id: "wismo_1055_partial", category: "WISMO", tenant: "test", contextSubject: "Kan I vente med at sende resten", orderNumber: "1055", message: "What is the status of order #1055? Some items seem to be missing from the shipment.", expectedTools: ["get_order", "inspect_fulfillment"], expectedFacts: ["partial fulfillment", "no tracking claim unless returned"] },
  { id: "wismo_1051_contents", category: "WISMO", tenant: "test", contextSubject: "Ordre 1051", orderNumber: "1051", message: "What was in my order #1051, and has it been fulfilled?", expectedTools: ["get_order"], expectedFacts: ["Shopify order items", "fulfilled status"] },
  { id: "wismo_9999_unresolved", category: "WISMO", tenant: "test", contextSubject: "Ordre 9999", message: "Where is my order #9999? It should have arrived last week.", expectedTools: ["get_order"], expectedFacts: ["order not found", "no unrelated history disclosure"] },
  { id: "wismo_1058_unresolved", category: "WISMO", tenant: "test", contextSubject: "Ordre 1058", message: "Can you tell me the status and delivery address for order #1058?", expectedTools: ["get_order"], expectedFacts: ["order not found", "no unrelated history disclosure"] },
  { id: "wismo_latest_order", category: "WISMO", tenant: "test", contextSubject: "Ordre 1051", message: "Where is my latest order?", expectedTools: ["get_order_history"], expectedFacts: ["legitimate recent-order history lookup"] },

  { id: "troubleshoot_spire_reset", category: "TROUBLESHOOTING", tenant: "sona", message: "How do I factory reset the A-Spire Wireless headset?", expectedTools: ["search_procedures"], expectedFacts: ["hold power at least 15 seconds", "saved Bluetooth connections are deleted"] },
  { id: "troubleshoot_blaze_pairing", category: "TROUBLESHOOTING", tenant: "sona", message: "My A-Blaze headset and USB-C dongle will not connect. What pairing steps should I try?", expectedTools: ["search_procedures"], expectedFacts: ["headset and dongle pairing sequence"] },
  { id: "troubleshoot_firmware", category: "TROUBLESHOOTING", tenant: "sona", message: "How do I update the A-Spire Wireless headset and dongle firmware?", expectedTools: ["search_procedures"], expectedFacts: ["Firmware Updater", "headset and dongle are updated separately"] },
  { id: "troubleshoot_microphone", category: "TROUBLESHOOTING", tenant: "sona", message: "My headset microphone is not working. What troubleshooting steps should I follow?", expectedTools: ["search_procedures"], expectedFacts: ["permissions", "input device", "test another device"] },
  { id: "troubleshoot_hinge", category: "TROUBLESHOOTING", tenant: "sona", message: "The hinge on my headset is cracked. What button sequence can repair it?", expectedTools: ["search_procedures"], expectedFacts: ["physical damage is not repaired by a button sequence"] },
  { id: "troubleshoot_ambiguous_model", category: "TROUBLESHOOTING", tenant: "sona", message: "My headset will not connect. What can you help me with?", expectedTools: [], expectedFacts: ["ask for model or relevant missing context"] },

  { id: "order_1051_items", category: "ORDER QUESTIONS", tenant: "test", contextSubject: "Ordre 1051", orderNumber: "1051", message: "What items did I order in #1051?", expectedTools: ["get_order"], expectedFacts: ["Shopify order items"] },
  { id: "order_1055_items_status", category: "ORDER QUESTIONS", tenant: "test", contextSubject: "Kan I vente med at sende resten", orderNumber: "1055", message: "Can you show the items and fulfillment status for order #1055?", expectedTools: ["get_order"], expectedFacts: ["Shopify order items", "partial fulfillment"] },
  { id: "order_recent_history", category: "ORDER QUESTIONS", tenant: "test", contextSubject: "Ordre 1051", message: "What have I ordered recently?", expectedTools: ["get_order_history"], expectedFacts: ["current customer history"] },
  { id: "order_1063_paid", category: "ORDER QUESTIONS", tenant: "test", contextSubject: "Hvor er min ordre #1063?", orderNumber: "1063", message: "Can you tell me whether order #1063 was paid?", expectedTools: ["get_order"], expectedFacts: ["Shopify financial status"] },

  { id: "multi_order_return", category: "MULTI-INTENT", tenant: "test", contextSubject: "Hvor er min pakke?", orderNumber: "1054", message: "Where is order #1054, and can I return it if it arrives damaged?", expectedTools: ["get_order", "get_tracking"], expectedFacts: ["live order facts", "return policy may be unavailable in Test tenant"] },
  { id: "multi_defect_warranty_replacement", category: "MULTI-INTENT", tenant: "sona", message: "My A-Spire Wireless is defective. Is it covered by warranty, and can I get a replacement?", expectedTools: ["search_policy"], expectedFacts: ["warranty is policy evidence", "replacement is not executed"] },
  { id: "multi_status_address", category: "MULTI-INTENT", tenant: "test", contextSubject: "Kan I vente med at sende resten", orderNumber: "1055", message: "What is the status of #1055, and can you change its delivery address?", expectedTools: ["get_order"], expectedFacts: ["partial status", "address change is only a proposal"] },
  { id: "multi_pairing_replacement", category: "MULTI-INTENT", tenant: "sona", message: "My A-Spire Wireless will not pair after reset. What should I try, and is a replacement covered by warranty?", expectedTools: ["search_procedures", "search_policy"], expectedFacts: ["pairing procedure", "warranty policy", "no replacement promise"] },
  { id: "multi_delivered_refund", category: "MULTI-INTENT", tenant: "test", contextSubject: "Hvor er min ordre #1063?", orderNumber: "1063", message: "Order #1063 shows delivered but I cannot find the package. What should I do, and can you refund it?", expectedTools: ["get_order", "get_tracking"], expectedFacts: ["verified delivered result", "refund is not executed"] },
];

const MULTI_TURN_CASES = [
  {
    id: "conversation_delivered_missing_then_found",
    category: "MULTI-TURN",
    tenant: "test",
    contextSubject: "Hvor er min ordre #1063?",
    orderNumber: "1063",
    turns: [
      "Where is my order #1063?",
      "It says delivered, but I cannot find the package. What should I do?",
      "If it is missing, can you refund me?",
      "Never mind, I found it at the pickup point. Thanks.",
    ],
  },
  {
    id: "conversation_troubleshooting_progression",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "My A-Spire Wireless headset will not pair with the dongle.",
      "I already unplugged and reconnected the dongle and put both devices in pairing mode.",
      "The dongle LED turns white. What should I try next?",
      "I also tried that and the headset still will not connect.",
    ],
  },
  {
    id: "conversation_product_ambiguity",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "My headset will not connect. Can you help?",
      "It is the A-Blaze.",
      "I already reset it. I need the next pairing steps.",
      "I use the USB-C dongle on a PC.",
    ],
  },
  {
    id: "conversation_return_facts_accumulate",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "Can I return my headset?",
      "I bought it from AceZone.io and received it 20 days ago.",
      "I opened the package, but the headset and packaging are complete.",
      "What information should I send to start the return?",
    ],
  },
  {
    id: "conversation_order_then_address",
    category: "MULTI-TURN",
    tenant: "test",
    contextSubject: "Kan I vente med at sende resten",
    orderNumber: "1055",
    turns: [
      "What is the status of my order #1055?",
      "Which items are still not shipped?",
      "Can you change the delivery address for that order?",
      "The new address is 12 Test Street, Copenhagen.",
    ],
  },
];

// Additional general conversations use the same real DEV knowledge/Test Store
// providers. They expand coverage without changing the five frozen controls.
const ADDITIONAL_MULTI_TURN_CASES = [
  {
    id: "conversation_tracking_followup",
    category: "MULTI-TURN",
    tenant: "test",
    contextSubject: "Hvor er min pakke?",
    orderNumber: "1054",
    turns: [
      "Where is order #1054?",
      "The tracking page shows nothing. Can you check the shipment?",
      "I meant the package from order #1054, not another order.",
      "Thanks, that is all for now.",
    ],
  },
  {
    id: "conversation_return_correction",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "Can I return my headset?",
      "I received it 20 days ago and it is still sealed.",
      "Correction: I opened it, but the headset and packaging are complete.",
      "What information should I send to start the return?",
    ],
  },
  {
    id: "conversation_product_correction",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "Does my headset work with PlayStation 5?",
      "Correction: it is the A-Rise, not the A-Blaze.",
      "Can I use Bluetooth for competitive gaming?",
      "That answers it, thanks.",
    ],
  },
  {
    id: "conversation_latest_order_followup",
    category: "MULTI-TURN",
    tenant: "test",
    contextSubject: "Ordre 1051",
    turns: [
      "What is my latest order?",
      "What items are in that order?",
      "Where is it now?",
      "Never mind, I will check again later.",
    ],
  },
  {
    id: "conversation_troubleshooting_resolution_then_new_question",
    category: "MULTI-TURN",
    tenant: "sona",
    turns: [
      "How do I factory reset the A-Spire Wireless headset?",
      "I reset it and it works now, thanks.",
      "How do I update the headset and dongle firmware?",
      "I only needed the firmware steps. Thanks.",
    ],
  },
];

const ALL_MULTI_TURN_CASES = [...MULTI_TURN_CASES, ...ADDITIONAL_MULTI_TURN_CASES];

async function findThreadContext(supabase, accessToken, subject, orderNumber, shopId) {
  const { data, error } = await supabase
    .from("mail_threads")
    .select("id, subject, customer_email, customer_name")
    .eq("workspace_id", TEST_WORKSPACE_ID)
    .eq("subject", subject)
    .limit(20);
  if (error) throw new Error(`Thread lookup failed: ${error.message}`);
  for (const thread of data ?? []) {
    if (!thread.customer_email) continue;
    const commerce = new ShopifyReadOnlyProvider({
      shopDomain: TEST_STORE_DOMAIN,
      accessToken,
      customer: { email: thread.customer_email, name: thread.customer_name },
    });
    const order = orderNumber ? await commerce.getOrder(orderNumber) : null;
    if (orderNumber && !order) continue;
    return { thread, commerce, order, shopId };
  }
  throw new Error(`No usable Test thread found for ${subject}.`);
}

async function loadThreadMessages(supabase, threadId) {
  const { data, error } = await supabase
    .from("mail_messages")
    .select("clean_body_text, body_text, from_me, received_at, created_at")
    .eq("thread_id", threadId)
    .order("received_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Message lookup failed: ${error.message}`);
  return (data ?? []).map((message) => ({
    from_me: Boolean(message.from_me),
    content: text(message.clean_body_text || message.body_text),
    received_at: message.received_at ?? message.created_at ?? null,
  }));
}

async function historicalComparison(supabase, accessToken, knowledge, shopId, sensitiveValues, definition) {
  const context = await findThreadContext(supabase, accessToken, definition.subject, definition.orderNumber, shopId);
  const messages = await loadThreadMessages(supabase, context.thread.id);
  const inbound = [...messages].reverse().find((message) => !message.from_me && message.content);
  const outbound = [...messages].reverse().find((message) => message.from_me && message.content);
  if (!inbound || !outbound) return { subject: definition.subject, available: false, reason: "No inbound/outbound pair found." };
  const tenant = {
    workspaceId: TEST_WORKSPACE_ID,
    shopId,
    customerEmail: context.thread.customer_email,
    customerName: context.thread.customer_name ?? null,
  };
  const run = await runGreenfieldAgentWithAgentsSdk({
    tenant,
    message: inbound.content,
    capabilities: { tenant, knowledge, commerce: context.commerce },
    maxTurns: 8,
  });
  return {
    subject: definition.subject,
    available: true,
    customer_message: maskString(inbound.content, sensitiveValues),
    raw_outbound_reply: maskString(outbound.content, sensitiveValues),
    greenfield_response: maskString(run.response, sensitiveValues),
    tools: traceToolSummary(run.trace, sensitiveValues),
    trace: safeTrace(run.trace, sensitiveValues),
    comparison_note: "The stored outbound reply is a comparison reference, not an automatic correctness label. The Test workspace has no greenfield policy corpus, so policy claims remain unproven in this tenant.",
  };
}

describe("broad greenfield ecommerce support quality baseline", () => {
  const test = RUN_BASELINE ? it : it.skip;

  test("runs frozen one-agent runtime against DEV knowledge and read-only Test Store data", async () => {
    loadEnvFile(resolve(process.cwd(), ".env.development.local"));
    loadEnvFile(resolve(process.cwd(), "apps/web/.env.development.local"));

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    expect(supabaseUrl).toContain(DEV_SUPABASE_REF);
    expect(serviceRoleKey).toBeTruthy();
    expect(process.env.OPENAI_API_KEY).toBeTruthy();

    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: shops, error: shopError } = await supabase
      .from("shops")
      .select("id, workspace_id, shop_domain, access_token_encrypted, uninstalled_at")
      .eq("workspace_id", TEST_WORKSPACE_ID)
      .eq("shop_domain", TEST_STORE_DOMAIN)
      .eq("platform", "shopify")
      .is("uninstalled_at", null)
      .limit(2);
    if (shopError) throw new Error(`Shop lookup failed: ${shopError.message}`);
    expect(shops).toHaveLength(1);
    expect(shops[0].shop_domain).toBe(TEST_STORE_DOMAIN);
    expect(encryptionKey).toBeTruthy();
    const accessToken = decryptShopifyToken(shops[0].access_token_encrypted, encryptionKey);
    const knowledge = new SupabaseKnowledgeStore(supabase);
    const sonaCommerce = unavailableCommerceProvider("acezone_shop_inactive_for_greenfield_eval");

    const primaryTestContext = await findThreadContext(supabase, accessToken, "Ordre 1051", "1051", shops[0].id);
    const history = await primaryTestContext.commerce.getOrderHistory(primaryTestContext.thread.customer_email);
    const knownOrders = new Map(history.map((order) => [order.orderNumber, order]));
    const sensitiveValues = new Set();
    for (const order of history) {
      for (const fulfillment of order.fulfillments ?? []) {
        if (fulfillment.trackingNumber) sensitiveValues.add(fulfillment.trackingNumber);
      }
    }

    const productProbe = await primaryTestContext.commerce.getProduct("Chaos Headset 4");
    const productVariants = productProbe && typeof productProbe === "object" && !Array.isArray(productProbe)
      ? (Array.isArray(productProbe.variants) ? productProbe.variants : [])
      : [];
    const inventoryKeys = Array.from(new Set(productVariants.flatMap((variant) => variant && typeof variant === "object" ? Object.keys(variant) : [])))
      .filter((key) => /inventory|stock|available|quantity/i.test(key));

    const requestViaDevShip24 = anonKey
      ? async (trackingNumber) => {
        const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/fetch-tracking`, {
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
      }
      : null;
    const testTracking = requestViaDevShip24 ? new Ship24ReadOnlyProvider({ requestImpl: requestViaDevShip24 }) : null;

    const directRetrievalQueries = [
      { id: "return_policy", query: "Can I return an opened headset after 20 days?", knowledgeTypes: ["policy"] },
      { id: "warranty", query: "How long is the warranty in the EU?", knowledgeTypes: ["policy"] },
      { id: "refund_timing", query: "When is the refund initiated after a return is processed?", knowledgeTypes: ["policy"] },
      { id: "shipping_expectations", query: "How long does an order take to leave the warehouse?", knowledgeTypes: ["policy"] },
      { id: "product_compatibility", query: "Is the A-Blaze compatible with PlayStation 5?", knowledgeTypes: ["product"] },
      { id: "procedure_pairing", query: "How do I pair the A-Blaze headset and USB dongle?", knowledgeTypes: ["procedural"] },
      { id: "brand_guidance", query: "What tone should a customer support reply use?", knowledgeTypes: ["brand"] },
    ];
    const directRetrieval = [];
    for (const item of directRetrievalQueries) {
      const hits = await knowledge.search({ workspaceId: SONA_WORKSPACE_ID, query: item.query, knowledgeTypes: item.knowledgeTypes, limit: 5 });
      directRetrieval.push({
        ...item,
        results: hits.map(({ record, score, rank, matchReason, evidenceSections }) => ({
          title: record.title,
          knowledge_type: record.knowledgeType,
          authority: record.authority,
          score: Number(score.toFixed(4)),
          rank,
          match_reason: matchReason,
          provenance: {
            source_kind: record.sourceKind,
            source_id: record.sourceId,
            source_label: record.sourceLabel,
            source_uri: record.sourceUri,
            published_at: record.publishedAt,
            observed_at: record.observedAt,
            expires_at: record.expiresAt,
          },
          evidence_sections: maskValue(evidenceSections, sensitiveValues),
        })),
      });
    }

    const contextCache = new Map();
    async function contextFor(item) {
      if (item.tenant === "sona") {
        return {
          tenant: { workspaceId: SONA_WORKSPACE_ID, shopId: null, customerEmail: null, customerName: null },
          knowledge,
          commerce: sonaCommerce,
          tracking: undefined,
          source: { tenant: "Sona Development", knowledge: "DEV Supabase greenfield knowledge", commerce: "inactive AceZone shop not used", tracking: "not configured" },
        };
      }
      const cacheKey = `${item.contextSubject ?? "Ordre 1051"}:${item.orderNumber ?? "history"}`;
      if (!contextCache.has(cacheKey)) contextCache.set(cacheKey, findThreadContext(supabase, accessToken, item.contextSubject ?? "Ordre 1051", item.orderNumber ?? null, shops[0].id));
      const context = await contextCache.get(cacheKey);
      return {
        tenant: { workspaceId: TEST_WORKSPACE_ID, shopId: shops[0].id, customerEmail: context.thread.customer_email, customerName: context.thread.customer_name ?? null },
        knowledge,
        commerce: context.commerce,
        tracking: testTracking ?? undefined,
        source: { tenant: "Test", knowledge: "DEV Supabase Test workspace (no greenfield records)", commerce: "Test Shopify Admin API read-only", tracking: testTracking ? "DEV fetch-tracking Edge Function → Ship24" : "unavailable" },
      };
    }

    const singleTurnResults = [];
    for (const item of SINGLE_TURN_CASES) {
      const context = await contextFor(item);
      const run = await runGreenfieldAgentWithAgentsSdk({
        tenant: context.tenant,
        message: item.message,
        capabilities: context,
        maxTurns: 8,
      });
      const tools = traceToolSummary(run.trace, sensitiveValues);
      singleTurnResults.push({
        id: item.id,
        category: item.category,
        tenant: item.tenant,
        customer_input: maskString(item.message, sensitiveValues),
        expected_tools: item.expectedTools,
        expected_facts: item.expectedFacts,
        data_sources: context.source,
        tools_selected: toolSequence(run.trace),
        tool_results: tools,
        final_response: maskString(run.response, sensitiveValues),
        proposed_actions: maskValue(run.proposedActions, sensitiveValues),
        response_flags: responseFlags(run.response, tools),
        trace_id: run.trace.traceId,
        trace: safeTrace(run.trace, sensitiveValues),
      });
    }

    const multiTurnResults = [];
    for (const conversation of ALL_MULTI_TURN_CASES) {
      const context = await contextFor(conversation);
      const historyItems = [];
      let conversationContext;
      const turns = [];
      for (const customerMessage of conversation.turns) {
        const run = await runGreenfieldAgentWithAgentsSdk({
          tenant: context.tenant,
          message: customerMessage,
          history: historyItems,
          conversationContext,
          capabilities: context,
          maxTurns: 8,
        });
        const tools = traceToolSummary(run.trace, sensitiveValues);
        turns.push({
          customer_input: maskString(customerMessage, sensitiveValues),
          tools_selected: toolSequence(run.trace),
          tool_results: tools,
          final_response: maskString(run.response, sensitiveValues),
          response_flags: responseFlags(run.response, tools),
          conversation_context: {
            turn: run.conversationContext.turn,
            active_order: run.conversationContext.activeOrder
              ? {
                  requested_order_id: run.conversationContext.activeOrder.requestedOrderId,
                  state: run.conversationContext.activeOrder.state,
                  verified_order_number: run.conversationContext.activeOrder.order?.orderNumber ?? null,
                }
              : { state: "unbound" },
            customer_signal: run.conversationContext.customerSignal,
          },
          trace_id: run.trace.traceId,
          trace: safeTrace(run.trace, sensitiveValues),
        });
        historyItems.push({ role: "user", content: customerMessage }, { role: "assistant", content: run.response });
        conversationContext = run.conversationContext;
      }
      multiTurnResults.push({
        id: conversation.id,
        category: conversation.category,
        tenant: conversation.tenant,
        turn_count: conversation.turns.length,
        data_sources: context.source,
        turns,
      });
    }

    const historicalDefinitions = [
      { subject: "Annuller 1054", orderNumber: "1054" },
      { subject: "Hvor er min ordre #1063?", orderNumber: "1063" },
      { subject: "Retur af 1051", orderNumber: "1051" },
    ];
    const historicalComparisons = [];
    for (const definition of historicalDefinitions) {
      historicalComparisons.push(await historicalComparison(supabase, accessToken, knowledge, shops[0].id, sensitiveValues, definition));
    }

    const artifact = {
      benchmark: {
        name: "broad_greenfield_ecommerce_support_quality_v1",
        runtime: "one Sona Support Agent via @openai/agents; frozen runtime",
        generated_at: new Date().toISOString(),
        single_turn_case_count: singleTurnResults.length,
        multi_turn_conversation_count: multiTurnResults.length,
        no_fixture_fallback: true,
      },
      preflight: {
        dev_supabase: { project_ref: DEV_SUPABASE_REF, project_name: "sona-development", url_or_keys_logged: false },
        knowledge_corpus: { workspace: "Sona Development", source: "DEV Supabase greenfield_knowledge_records/chunks", records: 15, chunks: 100 },
        test_store: { workspace: "Test", domain: TEST_STORE_DOMAIN, active_shop_verified: true, provider: "ShopifyReadOnlyProvider", write_methods_exposed: false },
        test_store_order_count_for_probe_customer: history.length,
        probe_orders: Array.from(knownOrders.values()).map((order) => orderSummary(order, sensitiveValues)),
        inventory_capability_available: false,
        inventory_audit: { product_probe: maskValue(productProbe, sensitiveValues), raw_variant_inventory_like_keys: inventoryKeys, normalized_model_capability: "none; no dedicated inventory tool or normalized stock field" },
        ship24: { verified: Boolean(testTracking), transport: testTracking ? "DEV fetch-tracking Edge Function" : "not configured" },
      },
      direct_retrieval: directRetrieval,
      single_turn: singleTurnResults,
      multi_turn: multiTurnResults,
      historical_comparisons: historicalComparisons,
      limitations: [
        "Sona Development's AceZone Shopify shop is inactive, so knowledge cases use real DEV Supabase knowledge but no AceZone live commerce.",
        "The Test workspace has the active Demo Store but no greenfield policy/product corpus; its knowledge lookups are intentionally empty rather than mixed with Sona Development.",
        "Inventory is not treated as available even if Shopify raw variant payloads contain inventory-like keys; the greenfield contract has no normalized inventory capability.",
        "No write operation, migration, deployment, or production provider was used by this benchmark.",
      ],
    };
    writeFileSync(ARTIFACT_PATH, `${JSON.stringify(maskValue(artifact, sensitiveValues), null, 2)}\n`);
    console.log("GREENFIELD_BROAD_SUPPORT_QUALITY_BASELINE");
    console.log(JSON.stringify({
      artifact_path: ARTIFACT_PATH,
      preflight: artifact.preflight,
      direct_retrieval: artifact.direct_retrieval.map((item) => ({ id: item.id, query: item.query, results: item.results.map(({ title, knowledge_type, authority, score, rank, provenance }) => ({ title, knowledge_type, authority, score, rank, provenance })) })),
      single_turn: singleTurnResults.map(({ id, category, tenant, customer_input, data_sources, tools_selected, final_response, response_flags }) => ({ id, category, tenant, customer_input, data_sources, tools_selected, final_response, response_flags })),
      multi_turn: multiTurnResults.map(({ id, tenant, turn_count, turns }) => ({ id, tenant, turn_count, turns: turns.map(({ customer_input, tools_selected, final_response, response_flags }) => ({ customer_input, tools_selected, final_response, response_flags })) })),
      historical_comparisons: historicalComparisons.map(({ subject, available, customer_message, raw_outbound_reply, greenfield_response, comparison_note }) => ({ subject, available, customer_message, raw_outbound_reply, greenfield_response, comparison_note })),
    }, null, 2));
  }, 1_800_000);
});
