import { NextResponse } from "next/server";
import { createDefaultCsatEmailContent } from "@/lib/csat/email-template";
import { renderCsatEmail } from "@/lib/server/csat-email";
import { loadPublishedCsatTemplate } from "@/lib/server/csat-store";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

const asString = (value) => (typeof value === "string" ? value.trim() : "");
const isCustomerEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asString(value));

export async function GET(_request, context) {
  try {
    const threadId = asString(context?.params?.threadId);
    if (!threadId) return NextResponse.json({ error: "Missing thread id." }, { status: 400 });

    const authContext = await requireCsatWorkspace();
    if (authContext.response) return authContext.response;
    const { serviceClient, workspaceId } = authContext;
    const [{ data: event, error: eventError }, { data: thread, error: threadError }] = await Promise.all([
      serviceClient
        .from("csat_survey_requests")
        .select("id, workspace_id, thread_id, status, sent_at")
        .eq("workspace_id", workspaceId)
        .eq("thread_id", threadId)
        .in("status", ["sent", "responded"])
        .not("sent_at", "is", null)
        .maybeSingle(),
      serviceClient
        .from("mail_threads")
        .select("id, workspace_id, mailbox_id, subject, customer_email, customer_name")
        .eq("workspace_id", workspaceId)
        .eq("id", threadId)
        .maybeSingle(),
    ]);
    if (eventError) throw new Error(eventError.message);
    if (threadError) throw new Error(threadError.message);
    if (!event?.id || !event.sent_at || !thread?.id) {
      return NextResponse.json({ error: "Sent CSAT email not found." }, { status: 404 });
    }

    const [published, mailboxResult, recipientResult] = await Promise.all([
      loadPublishedCsatTemplate(serviceClient, workspaceId),
      serviceClient
        .from("mail_accounts")
        .select("id, shop_id, provider_email, from_email, from_name")
        .eq("workspace_id", workspaceId)
        .eq("id", thread.mailbox_id)
        .maybeSingle(),
      isCustomerEmail(thread.customer_email)
        ? Promise.resolve({ data: null, error: null })
        : serviceClient
            .from("mail_messages")
            .select("from_email, extracted_customer_email, from_name, extracted_customer_name")
            .eq("thread_id", threadId)
            .eq("from_me", false)
            .order("received_at", { ascending: false, nullsLast: true })
            .limit(1)
            .maybeSingle(),
    ]);
    if (mailboxResult.error) throw new Error(mailboxResult.error.message);
    if (recipientResult.error) throw new Error(recipientResult.error.message);

    const recipientMessage = recipientResult.data;
    const recipient = isCustomerEmail(thread.customer_email)
      ? asString(thread.customer_email)
      : asString(recipientMessage?.extracted_customer_email || recipientMessage?.from_email);
    const customerName = asString(
      thread.customer_name || recipientMessage?.extracted_customer_name || recipientMessage?.from_name,
    );
    const mailbox = mailboxResult.data || {};
    let shop = null;
    if (mailbox.shop_id) {
      const { data, error } = await serviceClient
        .from("shops")
        .select("shop_name, shop_domain")
        .eq("id", mailbox.shop_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      shop = data;
    }

    const template = published || {
      editor_json: createDefaultCsatEmailContent({ linkMode: "preview" }),
      subject: "How was your support experience?",
      preview_text: "Your feedback helps us improve.",
    };
    const rendered = await renderCsatEmail({
      content: template.editor_json,
      subject: template.subject,
      previewText: template.preview_text,
      data: {
        customer: {
          first_name: customerName ? customerName.split(/\s+/)[0] : "there",
          full_name: customerName,
          email: recipient,
        },
        store: {
          name: asString(shop?.shop_name),
          url: shop?.shop_domain ? `https://${String(shop.shop_domain).replace(/^https?:\/\//i, "")}` : "",
        },
        conversation: {
          subject: asString(thread.subject),
          agent_name: asString(mailbox.from_name),
        },
        order: { number: "" },
      },
      linkMode: "test",
    });

    return NextResponse.json(
      { html: rendered.html, subject: rendered.subject, recipient, sent_at: event.sent_at },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Could not load the sent CSAT email." },
      { status: 500 },
    );
  }
}
