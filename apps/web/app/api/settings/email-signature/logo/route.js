import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { resolveEmailSignatureTargetUserId } from "@/lib/server/email-signature-auth";
import { uploadEmailSignatureImage } from "@/lib/server/email-signature-assets";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId || !scope?.supabaseUserId) {
      return NextResponse.json(
        { error: "Email signature images require workspace scope." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const targetUserId = await resolveEmailSignatureTargetUserId(
      serviceClient,
      scope,
      clerkUserId,
      formData.get("user_id")
    );
    const image = await uploadEmailSignatureImage(serviceClient, {
      supabaseUrl: SUPABASE_URL,
      workspaceId: scope.workspaceId,
      userId: targetUserId,
      file,
    });

    return NextResponse.json({ image: { url: image.url, content_type: image.contentType } }, { status: 200 });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return NextResponse.json(
      { error: error?.message || "Could not upload email signature logo." },
      { status }
    );
  }
}
