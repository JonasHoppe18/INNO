const TRACKING_NUMBER_RE =
  /\b(?:trackingnummer(?:et)?|sporingsnummer(?:et)?|tracking\s*(?:number|no\.?|#)?|track\s*(?:number|no\.?|#)?|sporing|awb|shipment|forsendelse)\s*(?:number|no\.?|#|nummer)?\s*(?::|=|\bis\b|\ber\b)?\s*([A-Z0-9][A-Z0-9 -]{7,38}[A-Z0-9])\b/gi;

const BARE_LONG_NUMBER_RE = /\b\d{9,34}\b/g;

const RETURN_CONTEXT_RE =
  /\b(return|returns|returned|returning|refund|refunded|reimbursement|money back|right of withdrawal|fortryd|retur|returnere|returneret|refusion|refundering|pengene tilbage|send(?:e|t)?\s+(?:varen|den|pakken|headsettet)?\s*tilbage|tilbage\s+til\s+jer)\b/i;

const CUSTOMER_SHIPPED_RE =
  /\b(shipped|sent|mailed|posted|dropped off|handed in|sendt|afsendt|indleveret|return shipment|returpakke|returforsendelse|sendt\s+med|indleveret\s+hos)\b/i;

const OUTBOUND_ORDER_TRACKING_RE =
  /\b(where is my order|where is my package|hvornår kommer|min pakke|min ordre|delivery status|leveringsstatus|shipment delayed|forsinket|tracking for my order|spor(?:ing)?\s+(?:på|for)\s+min\s+ordre)\b/i;

const ORDER_NUMBER_PATTERNS = [
  /#\s?(\d{3,8})\b/g,
  /\b(?:order|ordre|ordrenummer|bestilling)\s*(?:number|nr\.?|no\.?|#)?\s*[:#]?\s*(\d{3,8})\b/gi,
];

const REPLY_HISTORY_MARKER_RE =
  /(?:^|\n)\s*(?:-{2,}\s*Original Message\s*-{2,}|On .+? wrote:|Den .+? skrev:|Fra:\s|From:\s|Sendt:\s|Sent:\s|Til:\s|To:\s|Emne:\s|Subject:\s)/i;

export function normalizeTrackingNumber(value) {
  return String(value || "").replace(/[\s-]+/g, "").trim().toUpperCase();
}

export function messageBodyForReturnTracking(message = {}) {
  return String(
    message?.clean_body_text ||
      message?.body_text ||
      message?.snippet ||
      ""
  ).trim();
}

export function detectMentionedCarrier(message = "") {
  const text = String(message || "");
  const carriers = [
    [/\busps\b/i, "USPS"],
    [/\bups\b/i, "UPS"],
    [/\bfedex\b/i, "FedEx"],
    [/\bdhl\b/i, "DHL"],
    [/\bgls\b/i, "GLS"],
    [/\bpostnord\b/i, "PostNord"],
    [/\bdao\b/i, "DAO"],
    [/\bbring\b/i, "Bring"],
  ];
  for (const [pattern, label] of carriers) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function extractCustomerProvidedTrackingNumbers(message = "") {
  const text = String(message || "");
  const numbers = new Set();
  const addIfTrackingLike = (value) => {
    const normalized = normalizeTrackingNumber(value);
    if (normalized.length >= 9 && /\d/.test(normalized)) numbers.add(normalized);
  };

  for (const match of text.matchAll(TRACKING_NUMBER_RE)) {
    addIfTrackingLike(match?.[1] || "");
  }

  if (/\b(?:tracking|trackingnummer|sporing|sporingsnummer|awb|shipment|forsendelse|usps|ups|fedex|dhl|gls|postnord|dao|bring)\b/i.test(text)) {
    for (const match of text.matchAll(BARE_LONG_NUMBER_RE)) {
      addIfTrackingLike(match?.[0] || "");
    }
  }

  return [...numbers];
}

export function extractOrderNumberFromText(text = "") {
  const source = String(text || "");
  for (const pattern of ORDER_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match?.[1]) return `#${match[1]}`;
  }
  return null;
}

export function stripReplyHistory(value = "") {
  const withoutHistory = String(value || "").split(REPLY_HISTORY_MARKER_RE)[0] || "";
  return withoutHistory
    .split(/\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDetectedContextSnippet(message = "", trackingNumber = "") {
  const cleaned = stripReplyHistory(message);
  if (!cleaned) return "";
  const normalizedTracking = normalizeTrackingNumber(trackingNumber);
  const compact = cleaned.replace(/\s+/g, " ").trim();
  const compactUpper = compact.toUpperCase();
  let index = normalizedTracking ? compactUpper.indexOf(normalizedTracking) : -1;

  if (index < 0 && normalizedTracking) {
    const spacedPattern = normalizedTracking.split("").join("[\\s-]*");
    const match = compactUpper.match(new RegExp(spacedPattern));
    index = match?.index ?? -1;
  }

  if (index < 0) return compact.slice(0, 220);

  const before = compact.slice(0, index);
  const after = compact.slice(index);
  const sentenceStart = Math.max(
    before.lastIndexOf(". "),
    before.lastIndexOf("! "),
    before.lastIndexOf("? "),
    before.lastIndexOf("\n"),
  );
  const start = sentenceStart >= 0 ? sentenceStart + 1 : Math.max(0, index - 120);
  const afterEndCandidates = [after.indexOf(". "), after.indexOf("! "), after.indexOf("? ")]
    .filter((candidate) => candidate >= 0);
  const end = afterEndCandidates.length
    ? index + Math.min(...afterEndCandidates) + 1
    : Math.min(compact.length, index + normalizedTracking.length + 120);

  return compact.slice(start, end).trim().slice(0, 240);
}

function confidenceForReturnTracking({ sameMessageReturnLike, threadReturnLike, customerShippedLike, carrier }) {
  let confidence = 0.45;
  if (sameMessageReturnLike) confidence += 0.25;
  if (threadReturnLike) confidence += 0.15;
  if (customerShippedLike) confidence += 0.15;
  if (carrier) confidence += 0.05;
  return Math.min(0.98, Number(confidence.toFixed(2)));
}

export function isInboundCustomerMessage(message = {}) {
  return message?.from_me !== true;
}

export function detectReturnTrackingCandidates({ thread = {}, messages = [] } = {}) {
  const inboundMessages = (Array.isArray(messages) ? messages : []).filter(isInboundCustomerMessage);
  const threadContextText = [
    thread?.subject,
    thread?.snippet,
    thread?.classification_key,
    thread?.case_state_json?.intents?.map?.((intent) => intent?.type).join(" "),
    thread?.case_state_json?.entities?.order_numbers?.join?.(" "),
  ].filter(Boolean).join("\n");

  const threadReturnLike = RETURN_CONTEXT_RE.test(threadContextText);
  const seen = new Set();
  const candidates = [];

  for (const message of inboundMessages) {
    const body = messageBodyForReturnTracking(message);
    if (!body) continue;

    const trackingNumbers = extractCustomerProvidedTrackingNumbers(body);
    if (!trackingNumbers.length) continue;

    const sameMessageReturnLike = RETURN_CONTEXT_RE.test(body);
    const customerShippedLike = CUSTOMER_SHIPPED_RE.test(body) ||
      /\btracking\s*(?:number|nummer)?\s*(?:is|er|:)?\s*[A-Z0-9]/i.test(body);
    const outboundOnly = OUTBOUND_ORDER_TRACKING_RE.test(body) && !sameMessageReturnLike && !threadReturnLike;
    if (outboundOnly || (!sameMessageReturnLike && !threadReturnLike) || !customerShippedLike) {
      continue;
    }

    const carrier = detectMentionedCarrier(body);
    const orderNumber = extractOrderNumberFromText(body) ||
      extractOrderNumberFromText(threadContextText);
    const confidence = confidenceForReturnTracking({
      sameMessageReturnLike,
      threadReturnLike,
      customerShippedLike,
      carrier,
    });

    for (const normalized of trackingNumbers) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push({
        tracking_number: normalized,
        normalized_tracking_number: normalized,
        carrier,
        source_message_id: message?.id || null,
        detected_context: buildDetectedContextSnippet(body, normalized),
        confidence,
        customer_email: thread?.customer_email || message?.extracted_customer_email || message?.from_email || null,
        customer_name: thread?.customer_name || message?.extracted_customer_name || message?.from_name || null,
        order_number: orderNumber,
      });
    }
  }

  return candidates;
}

export async function loadReturnTrackingThreadContext(serviceClient, scope, threadId) {
  const id = String(threadId || "").trim();
  if (!id) throw Object.assign(new Error("thread_id is required."), { status: 400 });

  let threadQuery = serviceClient
    .from("mail_threads")
    .select("id, mailbox_id, workspace_id, user_id, ticket_number, subject, snippet, customer_email, customer_name, case_state_json, classification_key")
    .eq("id", id)
    .limit(1);
  if (scope?.workspaceId) threadQuery = threadQuery.eq("workspace_id", scope.workspaceId);
  else if (scope?.supabaseUserId) threadQuery = threadQuery.eq("user_id", scope.supabaseUserId);

  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) throw Object.assign(new Error(threadError.message), { status: 500 });
  if (!thread?.id) throw Object.assign(new Error("Thread not found."), { status: 404 });

  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("id, shop_id")
    .eq("id", thread.mailbox_id)
    .maybeSingle();
  if (mailboxError) throw Object.assign(new Error(mailboxError.message), { status: 500 });

  const { data: messages, error: messagesError } = await serviceClient
    .from("mail_messages")
    .select("id, thread_id, clean_body_text, body_text, snippet, from_me, from_email, from_name, extracted_customer_email, extracted_customer_name, received_at, created_at")
    .eq("thread_id", thread.id)
    .eq("mailbox_id", thread.mailbox_id)
    .order("received_at", { ascending: true, nullsLast: true });
  if (messagesError) throw Object.assign(new Error(messagesError.message), { status: 500 });

  return {
    thread,
    messages: Array.isArray(messages) ? messages : [],
    shop_id: mailbox?.shop_id || null,
    workspace_id: thread.workspace_id || scope?.workspaceId || null,
  };
}

export function buildReturnTrackingSuggestions({ thread, messages }) {
  return detectReturnTrackingCandidates({ thread, messages }).map((candidate) => ({
    ...candidate,
    existing_return_tracking_id: null,
    already_added: false,
    suggested_action: "Review and create return tracking row",
  }));
}

export async function markExistingReturnTrackingSuggestions(serviceClient, workspaceId, candidates = []) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const workspace = String(workspaceId || "").trim();
  const normalizedNumbers = [...new Set(rows
    .map((candidate) => normalizeTrackingNumber(
      candidate?.normalized_tracking_number || candidate?.tracking_number || "",
    ))
    .filter(Boolean))];

  if (!workspace || !normalizedNumbers.length) {
    return rows.map((candidate) => ({
      ...candidate,
      existing_return_tracking_id: null,
      already_added: false,
    }));
  }

  const { data, error } = await serviceClient
    .from("return_tracking_shipments")
    .select("id, normalized_tracking_number")
    .eq("workspace_id", workspace)
    .in("normalized_tracking_number", normalizedNumbers);
  if (error) throw Object.assign(new Error(friendlyReturnTrackingDbError(error)), { status: 500 });

  const existingByNumber = new Map(
    (Array.isArray(data) ? data : [])
      .map((row) => [normalizeTrackingNumber(row?.normalized_tracking_number), row?.id])
      .filter(([normalized, id]) => normalized && id),
  );

  return rows.map((candidate) => {
    const normalized = normalizeTrackingNumber(
      candidate?.normalized_tracking_number || candidate?.tracking_number || "",
    );
    const existingId = existingByNumber.get(normalized) || null;
    return {
      ...candidate,
      existing_return_tracking_id: existingId,
      already_added: Boolean(existingId),
    };
  });
}

export async function listReturnTrackingShipments(serviceClient, scope) {
  if (!scope?.workspaceId && !scope?.supabaseUserId) return [];
  let query = serviceClient
    .from("return_tracking_shipments")
    .select("id, workspace_id, shop_id, mail_thread_id, source_message_id, return_case_id, customer_email, customer_name, order_number, shopify_order_id, tracking_number, normalized_tracking_number, carrier, status, source, verification, detected_context, suggested_action, created_at, updated_at, mail_threads(ticket_number, subject)")
    .order("created_at", { ascending: false });
  if (scope?.workspaceId) query = query.eq("workspace_id", scope.workspaceId);
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(friendlyReturnTrackingDbError(error)), { status: 500 });
  return Array.isArray(data) ? data : [];
}

export function friendlyReturnTrackingDbError(error) {
  const message = String(error?.message || error || "");
  if (
    message.includes("return_tracking_shipments") &&
    (
      message.includes("schema cache") ||
      message.includes("Could not find the table") ||
      message.includes("does not exist") ||
      String(error?.code || "").toUpperCase() === "42P01" ||
      String(error?.code || "").toUpperCase() === "PGRST205"
    )
  ) {
    return "Return tracking is not set up yet. Run the migration before creating return rows.";
  }
  return message || "Return tracking request failed.";
}

export async function createReturnTrackingShipment(serviceClient, scope, input = {}) {
  const trackingNumber = String(input?.tracking_number || "").trim();
  if (!trackingNumber) {
    throw Object.assign(new Error("tracking_number is required."), { status: 400 });
  }

  const context = await loadReturnTrackingThreadContext(serviceClient, scope, input?.thread_id);
  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!normalized || normalized.length < 9) {
    throw Object.assign(new Error("tracking_number is invalid."), { status: 400 });
  }
  if (!context.workspace_id) {
    throw Object.assign(new Error("Workspace scope is required."), { status: 400 });
  }
  const sourceMessageId = String(input?.source_message_id || "").trim();
  if (
    sourceMessageId &&
    !context.messages.some((message) => String(message?.id || "") === sourceMessageId)
  ) {
    throw Object.assign(new Error("source_message_id does not belong to this thread."), { status: 400 });
  }

  const { data: existing, error: existingError } = await serviceClient
    .from("return_tracking_shipments")
    .select("*")
    .eq("workspace_id", context.workspace_id)
    .eq("normalized_tracking_number", normalized)
    .maybeSingle();
  if (existingError) throw Object.assign(new Error(friendlyReturnTrackingDbError(existingError)), { status: 500 });
  if (existing?.id) return { row: existing, duplicate: true };

  const carrier = String(input?.carrier || "").trim() || detectMentionedCarrier(input?.detected_context || "") || null;
  const detectedContext = buildDetectedContextSnippet(input?.detected_context || "", normalized);
  const now = new Date().toISOString();
  const row = {
    workspace_id: context.workspace_id,
    shop_id: context.shop_id,
    mail_thread_id: context.thread.id,
    source_message_id: sourceMessageId || null,
    return_case_id: input?.return_case_id || null,
    customer_email: String(input?.customer_email || context.thread.customer_email || "").trim() || null,
    customer_name: String(input?.customer_name || context.thread.customer_name || "").trim() || null,
    order_number: String(input?.order_number || "").trim() || null,
    shopify_order_id: String(input?.shopify_order_id || "").trim() || null,
    tracking_number: trackingNumber,
    normalized_tracking_number: normalized,
    carrier,
    status: "return_tracking_pending",
    source: "customer_message",
    verification: "unverified",
    detected_context: detectedContext || null,
    suggested_action: "Review return tracking",
    created_at: now,
    updated_at: now,
  };

  const { data: inserted, error: insertError } = await serviceClient
    .from("return_tracking_shipments")
    .insert(row)
    .select("*")
    .maybeSingle();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: duplicate, error: duplicateError } = await serviceClient
        .from("return_tracking_shipments")
        .select("*")
        .eq("workspace_id", context.workspace_id)
        .eq("normalized_tracking_number", normalized)
        .maybeSingle();
      if (duplicateError) throw Object.assign(new Error(duplicateError.message), { status: 500 });
      if (duplicate?.id) return { row: duplicate, duplicate: true };
    }
    throw Object.assign(new Error(friendlyReturnTrackingDbError(insertError)), { status: 500 });
  }
  return { row: inserted, duplicate: false };
}
