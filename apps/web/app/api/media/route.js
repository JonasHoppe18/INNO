import { NextResponse } from "next/server";
import { listWorkspaceMedia, uploadWorkspaceMedia } from "@/lib/server/workspace-media";
import { mediaErrorResponse, resolveMediaContext } from "@/lib/server/media-route-context";

export async function GET(request) {
  try {
    const context = await resolveMediaContext();
    if (context.response) return context.response;
    const before = new URL(request.url).searchParams.get("before") || undefined;
    const page = await listWorkspaceMedia(context.client, context.scope.workspaceId, { before });
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return mediaErrorResponse(error, "Could not load images.");
  }
}

export async function POST(request) {
  try {
    const context = await resolveMediaContext();
    if (context.response) return context.response;
    const formData = await request.formData();
    const item = await uploadWorkspaceMedia(context.client, {
      supabaseUrl: context.supabaseUrl,
      workspaceId: context.scope.workspaceId,
      userId: context.scope.supabaseUserId || null,
      file: formData.get("file"),
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return mediaErrorResponse(error, "Could not upload image.");
  }
}
