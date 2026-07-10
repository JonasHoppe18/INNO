import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { ensureManagedSendingDomain } from "@/lib/server/managed-sending-domain";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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

export async function POST(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const mailboxId = params?.id;
  if (!mailboxId) {
    return NextResponse.json({ error: "Mailbox id is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Server configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId && !scope?.supabaseUserId) {
      return NextResponse.json({ error: "No workspace access found." }, { status: 403 });
    }

    let mailboxQuery = serviceClient
      .from("mail_accounts")
      .select(
        "id, provider, provider_email, user_id, workspace_id, shop_id, sending_type, domain_status, metadata",
      )
      .eq("id", mailboxId)
      .maybeSingle();
    mailboxQuery = applyScope(mailboxQuery, scope);
    const { data: mailbox, error: mailboxError } = await mailboxQuery;

    if (mailboxError || !mailbox) {
      return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
    }
    if (mailbox.provider !== "smtp") {
      return NextResponse.json(
        { error: "Managed sender domains are only used by forwarded mailboxes." },
        { status: 400 },
      );
    }

    let shop = null;
    if (mailbox.shop_id) {
      const { data: shopData } = await serviceClient
        .from("shops")
        .select("id, shop_name, shop_domain")
        .eq("id", mailbox.shop_id)
        .maybeSingle();
      shop = shopData || null;
    }

    const managedSender = await ensureManagedSendingDomain({
      serviceClient,
      mailbox,
      shop,
      refreshPending: true,
    });

    return NextResponse.json({ managed_sender: managedSender }, { status: 200 });
  } catch (error) {
    console.error("Managed sender status check failed:", error);
    return NextResponse.json(
      { error: "Could not verify the sender domain. Please try again." },
      { status: 400 },
    );
  }
}
