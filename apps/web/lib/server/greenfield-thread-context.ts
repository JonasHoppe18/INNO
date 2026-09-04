import { applyScope } from "./workspace-auth";
import type { ConversationContext } from "../greenfield-support/types";

export const GREENFIELD_CONTEXT_COLUMN = "greenfield_conversation_context_json";
export const GREENFIELD_HISTORY_LIMIT = 20;

export interface GreenfieldThreadHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GreenfieldThreadState {
  thread: {
    id: string;
    workspace_id: string | null;
    customer_email?: string | null;
    customer_name?: string | null;
  };
  history: GreenfieldThreadHistoryMessage[];
  conversationContext?: ConversationContext;
  customer: { email: string | null; name: string | null };
}

export interface GreenfieldConversationContextStore {
  load(input: { workspaceId: string; threadId: string }): Promise<ConversationContext | undefined>;
  save(input: { workspaceId: string; threadId: string; context: ConversationContext }): Promise<void>;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripHtml(value: unknown): string {
  return asText(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Accept only the compact server-owned shape. Any stored order snapshot is
 * deliberately discarded so live operational facts cannot become memory.
 */
export function normalizeStoredConversationContext(value: unknown): ConversationContext | undefined {
  const source = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })()
    : value;
  if (!isRecord(source)) return undefined;

  const turn = source.turn;
  if (!Number.isSafeInteger(turn) || Number(turn) < 0) return undefined;

  let activeOrder: ConversationContext["activeOrder"] = null;
  if (source.activeOrder !== null && source.activeOrder !== undefined) {
    if (!isRecord(source.activeOrder)) return undefined;
    const requestedOrderId = asText(source.activeOrder.requestedOrderId);
    const state = source.activeOrder.state;
    if (!requestedOrderId || (state !== "unresolved" && state !== "verified")) return undefined;
    activeOrder = { requestedOrderId, state, order: null };
  }

  const customerSignal = source.customerSignal === "resolution" ? "resolution" : null;
  return { turn: Number(turn), activeOrder, customerSignal };
}

/** Converts a run result into the only form allowed in persistent storage. */
export function toStoredConversationContext(context: ConversationContext): ConversationContext {
  const normalized = normalizeStoredConversationContext(context);
  if (!normalized) {
    throw new Error("Greenfield conversation context is invalid.");
  }
  return normalized;
}

export function normalizeThreadHistory(rows: unknown): GreenfieldThreadHistoryMessage[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!isRecord(row)) return null;
      const content = asText(row.clean_body_text) || asText(row.body_text) || stripHtml(row.body_html);
      if (!content) return null;
      return {
        role: row.from_me === true ? "assistant" : "user",
        content: content.slice(0, 12_000),
      } satisfies GreenfieldThreadHistoryMessage;
    })
    .filter((message): message is GreenfieldThreadHistoryMessage => Boolean(message))
    .slice(-GREENFIELD_HISTORY_LIMIT);
}

function customerFromMessages(rows: unknown): { email: string | null; name: string | null } {
  if (!Array.isArray(rows)) return { email: null, name: null };
  for (const row of [...rows].reverse()) {
    if (!isRecord(row) || row.from_me === true) continue;
    return {
      email: asText(row.extracted_customer_email) || asText(row.from_email) || null,
      name: asText(row.extracted_customer_name) || asText(row.from_name) || null,
    };
  }
  return { email: null, name: null };
}

export function createGreenfieldConversationContextStore(serviceClient: any): GreenfieldConversationContextStore {
  return {
    async load({ workspaceId, threadId }) {
      let query = serviceClient
        .from("mail_threads")
        .select(GREENFIELD_CONTEXT_COLUMN)
        .eq("id", threadId);
      query = applyScope(query, { workspaceId });
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return normalizeStoredConversationContext(data?.[GREENFIELD_CONTEXT_COLUMN]);
    },

    async save({ workspaceId, threadId, context }) {
      let query = serviceClient
        .from("mail_threads")
        .update({ [GREENFIELD_CONTEXT_COLUMN]: toStoredConversationContext(context) })
        .eq("id", threadId);
      query = applyScope(query, { workspaceId });
      const { data, error } = await query.select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.id) throw new Error("Greenfield conversation context was not persisted.");
    },
  };
}

export async function loadGreenfieldThreadState(
  serviceClient: any,
  scope: { workspaceId?: string | null; supabaseUserId?: string | null },
  threadId: string,
): Promise<GreenfieldThreadState | null> {
  let threadQuery = serviceClient
    .from("mail_threads")
    .select(`id, workspace_id, customer_email, customer_name, ${GREENFIELD_CONTEXT_COLUMN}`)
    .eq("id", threadId);
  threadQuery = applyScope(threadQuery, scope);
  const { data: thread, error: threadError } = await threadQuery.maybeSingle();
  if (threadError) throw new Error(threadError.message);
  if (!thread) return null;

  let messagesQuery = serviceClient
    .from("mail_messages")
    .select("from_me, clean_body_text, body_text, body_html, from_email, from_name, extracted_customer_email, extracted_customer_name, created_at")
    .eq("thread_id", threadId)
    .eq("is_draft", false)
    .order("created_at", { ascending: false })
    .limit(GREENFIELD_HISTORY_LIMIT);
  messagesQuery = applyScope(messagesQuery, scope);
  const { data: messageRows, error: messagesError } = await messagesQuery;
  if (messagesError) throw new Error(messagesError.message);

  const chronologicalRows = Array.isArray(messageRows) ? [...messageRows].reverse() : [];
  const messageCustomer = customerFromMessages(chronologicalRows);
  return {
    thread,
    history: normalizeThreadHistory(chronologicalRows),
    conversationContext: normalizeStoredConversationContext(thread[GREENFIELD_CONTEXT_COLUMN]),
    customer: {
      email: asText(thread.customer_email) || messageCustomer.email,
      name: asText(thread.customer_name) || messageCustomer.name,
    },
  };
}
