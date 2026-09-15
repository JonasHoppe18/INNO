import { NextResponse } from "next/server";
import { loadThankYouMessages, saveThankYouMessages } from "@/lib/server/csat-store";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

export async function GET() {
  try {
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const messages = await loadThankYouMessages(context.serviceClient, context.workspaceId);
    return NextResponse.json({ messages }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not load Thank You messages." }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const result = await saveThankYouMessages(
      context.serviceClient,
      context.workspaceId,
      body?.messages,
      context.clerkUserId
    );
    return NextResponse.json({ messages: result.messages }, { status: 200 });
  } catch (error) {
    const status = error?.name === "CsatTemplateValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message || "Could not save Thank You messages." }, { status });
  }
}
