
import { NextResponse } from "next/server";
import { parseAndVerifyClientState } from "@/lib/outlook";

const SUPABASE_BASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const INTERNAL_AGENT_SECRET = process.env.INTERNAL_AGENT_SECRET || "";
const OUTLOOK_POLL_SECRET = process.env.OUTLOOK_POLL_SECRET || "";

export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const validationToken = searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return new Response("Ok", { status: 200 });
}

export async function POST(request) {
  const payload = await request.json().catch(() => ({}));
  const notifications = Array.isArray(payload?.value) ? payload.value : [];

  const processed = [];
  const rejected = [];

  for (const notification of notifications) {
    const clientState = notification?.clientState;
    const { valid, userId } = parseAndVerifyClientState(clientState);
    if (!valid || !userId) {
      rejected.push({ reason: "invalid_client_state", notification });
      continue;
    }

    const messageId =
      notification?.resourceData?.id ||
      notification?.resource?.split("/").pop();
    if (!messageId) {
      rejected.push({ reason: "missing_message_id", notification });
      continue;
    }

    if (!SUPABASE_BASE_URL || !SUPABASE_ANON_KEY || !(OUTLOOK_POLL_SECRET || INTERNAL_AGENT_SECRET)) {
      rejected.push({ reason: "missing_supabase_config", userId, messageId });
      continue;
    }

    try {
      const response = await fetch(`${SUPABASE_BASE_URL}/functions/v1/outlook-poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          "x-internal-secret": OUTLOOK_POLL_SECRET || INTERNAL_AGENT_SECRET,
        },
        body: JSON.stringify({
          userId,
          userLimit: 1,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessage =
          typeof data?.error === "string" ? data.error : `HTTP ${response.status}`;
        throw new Error(errorMessage);
      }

      processed.push({
        userId,
        messageId,
        subscriptionId: notification?.subscriptionId,
        polled: true,
        result: data?.results?.[0] || null,
      });
    } catch (error) {
      console.error("Webhook handling failed:", error);
      rejected.push({
        reason: "processing_failed",
        error: error?.message,
        userId,
        messageId,
      });
    }
  }

  return NextResponse.json(
    {
      received: notifications.length,
      drafted: processed.length,
      processed,
      rejected,
    },
    { status: 202 }
  );
}
