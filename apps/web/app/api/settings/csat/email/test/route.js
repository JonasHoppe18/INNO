import { NextResponse } from "next/server";
import { sendPostmarkEmail } from "@/lib/server/postmark";
import { buildEffectiveSharedFromEmail } from "@/lib/server/sending-identity";
import { loadCsatDraft } from "@/lib/server/csat-store";
import { renderCsatEmail } from "@/lib/server/csat-email";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

const FALLBACK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const FALLBACK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona Support";

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  try {
    const body = await request.json();
    const recipient = string(body?.recipient).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return NextResponse.json({ error: "Enter a valid test email address." }, { status: 400 });
    }
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const draft = await loadCsatDraft(context.serviceClient, context.workspaceId);
    const rendered = await renderCsatEmail({
      content: body?.editor_json || draft.editor_json,
      subject: body?.subject || draft.subject,
      linkMode: "test",
    });

    const { data: mailbox, error: mailboxError } = await context.serviceClient
      .from("mail_accounts")
      .select("id, provider_email, from_email, from_name")
      .eq("workspace_id", context.workspaceId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (mailboxError) throw new Error(mailboxError.message);
    const fromEmail = string(buildEffectiveSharedFromEmail({ mailbox })) || FALLBACK_FROM_EMAIL;
    const fromName = string(mailbox?.from_name) || FALLBACK_FROM_NAME;

    await sendPostmarkEmail({
      From: `${fromName} <${fromEmail}>`,
      To: recipient,
      Subject: `[TEST] ${rendered.subject}`,
      TextBody: rendered.text,
      HtmlBody: rendered.html,
      ReplyTo: string(mailbox?.from_email || mailbox?.provider_email) || fromEmail,
      Tag: "csat-email-builder-test",
      Metadata: {
        sona_test_send: "true",
        sona_workspace_id: context.workspaceId,
        sona_csat_response_disabled: "true",
      },
    });
    return NextResponse.json({ ok: true, sent_to: recipient }, { status: 200 });
  } catch (error) {
    const status = error?.name === "CsatTemplateValidationError" ? 400 : 500;
    console.error("[csat-email-test] Failed to send test email", error);
    return NextResponse.json({ error: error.message || "Could not send the CSAT test email." }, { status });
  }
}
