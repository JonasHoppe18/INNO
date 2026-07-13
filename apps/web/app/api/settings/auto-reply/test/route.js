import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  renderCustomerConfirmation,
} from "@/lib/server/customer-confirmation";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "";
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN || "";
const POSTMARK_MESSAGE_STREAM = process.env.POSTMARK_MESSAGE_STREAM || "outbound";
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
  if (!supabase || !POSTMARK_SERVER_TOKEN) {
    return NextResponse.json({ error: "Email service configuration is missing." }, { status: 500 });
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
    const fromEmail = string(mailbox.from_email || mailbox.provider_email) || FALLBACK_FROM_EMAIL;
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

    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
      },
      body: JSON.stringify({
        MessageStream: POSTMARK_MESSAGE_STREAM,
        From: `${fromName} <${fromEmail}>`,
        To: recipient,
        Subject: rendered.subject,
        TextBody: rendered.text,
        HtmlBody: rendered.html,
        ReplyTo: fromEmail,
        Tag: "customer-confirmation-test",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.Message || "Could not send test confirmation.");
    return NextResponse.json({ ok: true, sent_to: recipient }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not send test confirmation." }, { status: 500 });
  }
}
