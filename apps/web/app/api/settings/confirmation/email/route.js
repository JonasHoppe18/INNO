import {
  confirmationContext,
  loadConfirmationDraft,
  saveConfirmationDraft,
  syncConfirmationDraftSubject,
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
    const body = await request.json();
    if (body?.subject_only) {
      await syncConfirmationDraftSubject(context, body.subject);
      return Response.json({ ok: true });
    }
    const draft = await saveConfirmationDraft(context, body);
    return Response.json({ draft });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: error.name === "CsatTemplateValidationError" ? 400 : 500 },
    );
  }
}
