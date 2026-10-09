import { NextResponse } from "next/server";
import { softDeleteWorkspaceMedia } from "@/lib/server/workspace-media";
import { mediaErrorResponse, resolveMediaContext } from "@/lib/server/media-route-context";

export async function DELETE(_request, { params }) {
  try {
    const context = await resolveMediaContext();
    if (context.response) return context.response;
    const hidden = await softDeleteWorkspaceMedia(context.client, context.scope.workspaceId, params?.id);
    if (!hidden) return NextResponse.json({ error: "Image not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mediaErrorResponse(error, "Could not delete image.");
  }
}
