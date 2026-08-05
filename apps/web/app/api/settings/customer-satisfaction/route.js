import { NextResponse } from "next/server";

import {
  customerSatisfactionDatabaseValues,
  loadCustomerSatisfactionSettings,
  removeCustomerSatisfactionLogo,
  requireCustomerSatisfactionContext,
} from "@/lib/server/customer-satisfaction";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireCustomerSatisfactionContext();
    if (context.response) return context.response;
    const settings = await loadCustomerSatisfactionSettings(context.serviceClient, context.scope.workspaceId);
    return NextResponse.json({ settings }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const context = await requireCustomerSatisfactionContext();
    if (context.response) return context.response;
    const { serviceClient, scope } = context;
    const { data: existing, error: existingError } = await serviceClient
      .from("workspace_customer_satisfaction_settings")
      .select("company_name, sender_name, logo_path, logo_name")
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (body?.removeLogo === true && existing?.logo_path) {
      await removeCustomerSatisfactionLogo(serviceClient, existing.logo_path);
    }

    const values = customerSatisfactionDatabaseValues(body, scope.workspaceId, body?.removeLogo === true ? {} : existing || {});
    if (body?.removeLogo === true) {
      values.logo_path = null;
      values.logo_name = null;
    }

    const { error: upsertError } = await serviceClient
      .from("workspace_customer_satisfaction_settings")
      .upsert(values, { onConflict: "workspace_id" });
    if (upsertError) throw new Error(upsertError.message);

    const settings = await loadCustomerSatisfactionSettings(serviceClient, scope.workspaceId);
    return NextResponse.json({ settings }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
