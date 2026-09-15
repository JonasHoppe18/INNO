import { NextResponse } from "next/server";
import { renderCsatEmail } from "@/lib/server/csat-email";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

export async function POST(request) {
  try {
    const body = await request.json();
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const rendered = await renderCsatEmail({
      content: body?.editor_json,
      subject: body?.subject,
      previewText: body?.preview_text,
      data: body?.preview_data,
      linkMode: "test",
    });
    return NextResponse.json({
      html: rendered.html,
      text: rendered.text,
      subject: rendered.subject,
    }, { status: 200 });
  } catch (error) {
    const status = error?.name === "CsatTemplateValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message || "Could not render the CSAT preview." }, { status });
  }
}
