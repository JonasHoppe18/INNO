import { confirmationContext } from "@/lib/server/confirmation-store";
import { previewConfirmationEmail } from "@/lib/server/confirmation-email";
export async function POST(request) {
  try {
    const context = await confirmationContext(request);
    if (context.response) return context.response;
    const body = await request.json();
    const rendered = await previewConfirmationEmail(
      {
        content: body.editor_json,
        subject: body.subject,
        previewText: body.preview_text,
      },
      context.setting.include_ticket_number,
    );
    return Response.json(rendered);
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: error.name === "CsatTemplateValidationError" ? 400 : 500 },
    );
  }
}
