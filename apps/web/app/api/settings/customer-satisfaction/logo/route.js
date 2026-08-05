import { NextResponse } from "next/server";

import {
  CUSTOMER_SATISFACTION_STORAGE_BUCKET,
  loadCustomerSatisfactionSettings,
  requireCustomerSatisfactionContext,
} from "@/lib/server/customer-satisfaction";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MIME_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

export async function POST(request) {
  try {
    const context = await requireCustomerSatisfactionContext();
    if (context.response) return context.response;
    const formData = await request.formData();
    const file = formData.get("logo");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "A logo file is required." }, { status: 400 });
    }
    if (!MIME_EXTENSIONS[file.type]) {
      return NextResponse.json({ error: "Logo must be a PNG, JPG or SVG file." }, { status: 400 });
    }
    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: "Logo must be smaller than 2 MB." }, { status: 400 });
    }

    const { serviceClient, scope } = context;
    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_customer_satisfaction_settings")
      .select("logo_path")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const extension = MIME_EXTENSIONS[file.type];
    const logoPath = `${scope.workspaceId}/customer-satisfaction/logo.${extension}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await serviceClient.storage
      .from(CUSTOMER_SATISFACTION_STORAGE_BUCKET)
      .upload(logoPath, fileBuffer, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: true,
      });
    if (uploadError) throw new Error(uploadError.message);

    if (existing?.logo_path && existing.logo_path !== logoPath) {
      const { error: removeError } = await serviceClient.storage
        .from(CUSTOMER_SATISFACTION_STORAGE_BUCKET)
        .remove([existing.logo_path]);
      if (removeError) throw new Error(removeError.message);
    }

    const nowIso = new Date().toISOString();
    const { error: settingsError } = await serviceClient
      .from("workspace_customer_satisfaction_settings")
      .upsert({
        workspace_id: scope.workspaceId,
        logo_path: logoPath,
        logo_name: String(file.name || `logo.${extension}`).trim().slice(0, 255),
        updated_at: nowIso,
      }, { onConflict: "workspace_id" });
    if (settingsError) throw new Error(settingsError.message);

    const settings = await loadCustomerSatisfactionSettings(serviceClient, scope.workspaceId);
    return NextResponse.json({ settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
