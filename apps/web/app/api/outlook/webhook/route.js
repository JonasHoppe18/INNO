
import { NextResponse } from "next/server";
import { parseAndVerifyClientState } from "@/lib/outlook";

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

  const accepted = [];
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

    accepted.push({
      userId,
      messageId,
      subscriptionId: notification?.subscriptionId || null,
      ignored: true,
      reason: "forwarding_postmark_only",
    });
  }

  return NextResponse.json(
    {
      received: notifications.length,
      accepted: accepted.length,
      acceptedEvents: accepted,
      rejected,
      mode: "forwarding_postmark_only",
    },
    { status: 202 }
  );
}
