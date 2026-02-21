import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { getPostmarkDomain, isPostmarkDomainVerified } from "@/lib/server/postmark";
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

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function logAgentStatus(serviceClient, stepName, status, detail) {
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: stepName,
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

export async function GET(_request, { params }) {
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
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let scope = null;
  try {
    scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "No workspace or user scope found." }, { status: 403 });
  }

  let mailboxQuery = serviceClient
    .from("mail_accounts")
    .select("id, user_id, workspace_id, postmark_domain_id, domain_status")
    .eq("id", mailboxId)
    .maybeSingle();
  mailboxQuery = applyScope(mailboxQuery, scope);
  const { data: mailbox, error: mailboxError } = await mailboxQuery;

  if (mailboxError || !mailbox) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }
  if (!mailbox.postmark_domain_id) {
    return NextResponse.json(
      { error: "No Postmark domain setup found for this mailbox." },
      { status: 400 }
    );
  }

  try {
    const domainResponse = await getPostmarkDomain(mailbox.postmark_domain_id);
    const isVerified = isPostmarkDomainVerified(domainResponse);
    const domainStatus = isVerified ? "verified" : "pending";

    let updateQuery = serviceClient
      .from("mail_accounts")
      .update({
        domain_status: domainStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mailboxId);
    updateQuery = applyScope(updateQuery, scope);
    await updateQuery;

    const rawFlags = {
      dkim_verified: Boolean(domainResponse?.DKIMVerified),
      return_path_verified: Boolean(domainResponse?.ReturnPathDomainVerified),
    };

    await logAgentStatus(serviceClient, "postmark_domain_status_checked", "info", {
      mailbox_id: mailboxId,
      domain_status: domainStatus,
      ...rawFlags,
    });

    if (isVerified && mailbox.domain_status !== "verified") {
      await logAgentStatus(serviceClient, "postmark_domain_verified", "success", {
        mailbox_id: mailboxId,
      });
    }

    return NextResponse.json(
      {
        domain_status: domainStatus,
        raw_flags: rawFlags,
      },
      { status: 200 }
    );
  } catch (error) {
    const safeError = String(error?.message || "Could not check domain status.").slice(0, 280);
    let errorUpdateQuery = serviceClient
      .from("mail_accounts")
      .update({ domain_status: "error", smtp_last_error: safeError, updated_at: new Date().toISOString() })
      .eq("id", mailboxId);
    errorUpdateQuery = applyScope(errorUpdateQuery, scope);
    await errorUpdateQuery;

    await logAgentStatus(serviceClient, "postmark_domain_status_checked", "error", {
      mailbox_id: mailboxId,
      error: safeError,
    });

    return NextResponse.json({ error: safeError }, { status: 400 });
  }
}
