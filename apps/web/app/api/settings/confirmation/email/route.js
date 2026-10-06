import {
  confirmationContext,
  loadConfirmationDraft,
  saveConfirmationDraft,
} from "@/lib/server/confirmation-store";
export async function GET(request) {
  try {
    const context = await confirmationContext(request);
    if (context.response) return context.response;
    return Response.json(
      { draft: await loadConfirmationDraft(context) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
export async function PATCH(request) {
  try {
    const context = await confirmationContext(request);
    if (context.response) return context.response;
    const draft = await saveConfirmationDraft(context, await request.json());
    return Response.json({ draft });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: error.name === "CsatTemplateValidationError" ? 400 : 500 },
    );
  }
}
