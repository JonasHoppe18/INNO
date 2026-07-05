import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

import {
  createReturnTrackingShipment,
  listReturnTrackingShipments,
} from "@/lib/server/return-tracking";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function errorResponse(error) {
  const status = Number(error?.status || 500);
  return NextResponse.json(
    { error: error?.message || "Return tracking request failed." },
    { status },
  );
}

export async function GET() {
  try {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    const rows = await listReturnTrackingShipments(serviceClient, scope);
    return NextResponse.json({ rows }, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    const result = await createReturnTrackingShipment(serviceClient, scope, {
      thread_id: body?.thread_id,
      source_message_id: body?.source_message_id,
      tracking_number: body?.tracking_number,
      carrier: body?.carrier,
      customer_email: body?.customer_email,
      customer_name: body?.customer_name,
      order_number: body?.order_number,
      shopify_order_id: body?.shopify_order_id,
      return_case_id: body?.return_case_id,
      detected_context: body?.detected_context,
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
