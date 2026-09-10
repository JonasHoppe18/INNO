import { NextResponse } from "next/server";
import { publishCsatDraft } from "@/lib/server/csat-store";
import { requireCsatWorkspace } from "@/lib/server/csat-route";

export async function POST() {
  try {
    const context = await requireCsatWorkspace();
    if (context.response) return context.response;
    const result = await publishCsatDraft(context.serviceClient, context.workspaceId, {
      clerkUserId: context.clerkUserId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const status = error?.name === "CsatTemplateValidationError" ? 400 : 500;
    return NextResponse.json({ error: error.message || "Could not publish the CSAT email." }, { status });
  }
}
