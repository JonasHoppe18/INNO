import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { sendPostmarkEmail } from "@/lib/server/postmark";
import { buildEffectiveSharedFromEmail } from "@/lib/server/sending-identity";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  renderCustomerConfirmation,
} from "@/lib/server/customer-confirmation";

const { url: SUPABASE_URL, serviceKey: SERVICE_KEY } = resolveSupabaseServerConfig();
const FALLBACK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const FALLBACK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona Support";

function serviceClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const recipient = string(body?.recipient).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json({ error: "Enter a valid test email address." }, { status: 400 });
  }

  try {
    const scope = await resolveAuthScope(supabase, { clerkUserId, orgId });
    if (!scope.workspaceId) return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });

    let mailboxQuery = supabase
      .from("mail_accounts")
      .select("id, provider_email, from_email, from_name")
      .eq("workspace_id", scope.workspaceId);
    const mailboxId = string(body?.mailbox_id);
    if (mailboxId) mailboxQuery = mailboxQuery.eq("id", mailboxId);
    const { data: mailboxes, error: mailboxError } = await mailboxQuery
      .order("created_at", { ascending: true })
      .limit(1);
    if (mailboxError) throw new Error(mailboxError.message);
    if (mailboxId && !mailboxes?.[0]?.id) {
      return NextResponse.json({ error: "Mailbox not found in this workspace." }, { status: 400 });
    }

    const mailbox = mailboxes?.[0] || {};
    const fromEmail =
      string(buildEffectiveSharedFromEmail({ mailbox })) || FALLBACK_FROM_EMAIL;
    const fromName = string(mailbox.from_name) || FALLBACK_FROM_NAME;
    const rendered = renderCustomerConfirmation({
      subjectTemplate: string(body?.subject_template) || CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
      bodyTextTemplate: string(body?.body_text_template) || CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
      bodyHtmlTemplate: string(body?.body_html_template),
      templateHtml: string(body?.template_html) || CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
      includeTicketNumber: body?.include_ticket_number !== false,
      ticketNumber: 50001,
      tokens: {
        customer_name: "Sample Customer",
        customer_first_name: "Sam",
        team_name: fromName,
        subject: "Sample support request",
      },
    });

    await sendPostmarkEmail({
      From: `${fromName} <${fromEmail}>`,
      To: recipient,
      Subject: rendered.subject,
      TextBody: rendered.text,
      HtmlBody: rendered.html,
      ReplyTo: string(mailbox.from_email || mailbox.provider_email) || fromEmail,
      Tag: "customer-confirmation-test",
    });
    return NextResponse.json({ ok: true, sent_to: recipient }, { status: 200 });
  } catch (error) {
    console.error("[customer-confirmation-test] Failed to send test email", error);
    return NextResponse.json({ error: error.message || "Could not send test confirmation." }, { status: 500 });
  }
}
