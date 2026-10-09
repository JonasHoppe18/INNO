import { NextResponse } from "next/server";
import { restoreWorkspaceMedia } from "@/lib/server/workspace-media";
import { mediaErrorResponse, resolveMediaContext } from "@/lib/server/media-route-context";

export async function POST(_request, { params }) {
  try {
    const context = await resolveMediaContext();
    if (context.response) return context.response;
    const restored = await restoreWorkspaceMedia(context.client, context.scope.workspaceId, params?.id);
    if (!restored) return NextResponse.json({ error: "Image not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mediaErrorResponse(error, "Could not restore image.");
  }
}
