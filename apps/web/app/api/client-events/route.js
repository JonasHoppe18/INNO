import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const ALLOWED_EVENTS = new Set([
  "ticket_switch_started",
  "ticket_switch_completed",
  "thread_detail_loaded",
  "draft_saved",
  "send_completed",
  "frontend_error",
]);

function normalizeClientEvent(payload = {}) {
  const event = String(payload?.event || "").trim();
  if (!ALLOWED_EVENTS.has(event)) return null;
  const durationMs = Number(payload?.durationMs);
  return {
    event,
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
    threadId: payload?.threadId ? String(payload.threadId).slice(0, 120) : null,
    status: payload?.status ? String(payload.status).slice(0, 80) : null,
    errorCode: payload?.errorCode ? String(payload.errorCode).slice(0, 120) : null,
    timestamp: payload?.timestamp ? String(payload.timestamp).slice(0, 80) : new Date().toISOString(),
  };
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const event = normalizeClientEvent(payload);
  if (!event) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  console.info("[client-event]", {
    ...event,
    clerkUserId,
    orgId: orgId || null,
  });

  return NextResponse.json({ ok: true }, { status: 202 });
}
