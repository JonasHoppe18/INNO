import { NextResponse } from "next/server";
import { loadCsatDraft, loadPublishedCsatTemplate, saveCsatDraft } from "@/lib/server/csat-store";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

export async function GET() {
  try {
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const [draft, published] = await Promise.all([
      loadCsatDraft(context.serviceClient, context.workspaceId),
      loadPublishedCsatTemplate(context.serviceClient, context.workspaceId),
    ]);
    return NextResponse.json({ draft, published }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not load the CSAT email builder." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const draft = await saveCsatDraft(context.serviceClient, context.workspaceId, {
      name: body?.name,
      subject: body?.subject,
      previewText: body?.preview_text,
      content: body?.editor_json,
      clerkUserId: context.clerkUserId,
    });
    return NextResponse.json({ draft }, { status: 200 });
  } catch (error) {
    const status = error?.name === "CsatTemplateValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message || "Could not save the CSAT draft." }, { status });
  }
}
