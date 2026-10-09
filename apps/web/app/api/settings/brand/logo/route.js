import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createStatelessServiceClient } from "@/lib/server/stateless-service-client";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { uploadEmailSignatureImage } from "@/lib/server/email-signature-assets";

// Uploads the file only. The brand keeps its current logo until the URL is saved.
export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const config = resolveSupabaseServerConfig();
  const serviceClient = createStatelessServiceClient(config.url, config.serviceKey);
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }
    const formData = await request.formData();
    const image = await uploadEmailSignatureImage(serviceClient, {
      supabaseUrl: config.url,
      workspaceId: scope.workspaceId,
      userId: "brand",
      file: formData.get("file"),
    });
    return NextResponse.json({ url: image.url }, { status: 200 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json({ error: error?.message || "Could not upload logo." }, { status });
  }
}
