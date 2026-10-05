import {
  confirmationContext,
  publishConfirmationDraft,
} from "@/lib/server/confirmation-store";
export async function POST(request) {
  try {
    const context = await confirmationContext(request);
    if (context.response) return context.response;
    const draft = await publishConfirmationDraft(context);
    return Response.json({ draft, published: { version: draft.version } });
  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: error.message?.includes("draft changed") ? 409 : 400 },
    );
  }
}
