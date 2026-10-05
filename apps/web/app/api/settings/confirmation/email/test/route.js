import { confirmationContext } from "@/lib/server/confirmation-store";
import { compileConfirmationEmail } from "@/lib/server/confirmation-email";
import { POST as sendTest } from "@/app/api/settings/auto-reply/test/route";
import { NextRequest } from "next/server";
export async function POST(request) {
  try {
    const context = await confirmationContext(request);
    if (context.response) return context.response;
    const body = await request.json();
    const compiled = await compileConfirmationEmail({
      content: body.editor_json,
      subject: body.subject,
      previewText: body.preview_text,
    });
    return sendTest(
      new NextRequest(new URL("/api/settings/auto-reply/test", request.url), {
        method: "POST",
        headers: {
          ...Object.fromEntries(request.headers),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: body.recipient,
          mailbox_id: context.mailboxId,
          subject_template: compiled.subject,
          body_text_template: compiled.text,
          body_html_template: "",
          template_html: compiled.html,
          include_ticket_number: context.setting.include_ticket_number,
        }),
      }),
    );
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: error.name === "CsatTemplateValidationError" ? 400 : 500 },
    );
  }
}
