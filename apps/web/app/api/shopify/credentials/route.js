import { NextResponse } from "next/server";
import {
  createServiceSupabase,
  encryptString,
  getAuthContext,
  getUserId,
  isValidShopDomain,
  normalizeShopDomain,
} from "@/lib/server/shopify-oauth";

export async function POST(request) {
  try {
    const supabase = createServiceSupabase();
    const ownerUserId = await getUserId(request, supabase);
    const { workspaceId } = await getAuthContext(request, supabase);

    if (!ownerUserId) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const shopDomain = normalizeShopDomain(body?.shop_domain || "");
    const clientId = String(body?.client_id || "").trim();
    const clientSecret = String(body?.client_secret || "").trim();
    if (!shopDomain || !isValidShopDomain(shopDomain)) {
      return NextResponse.json(
        {
          error:
            "shop_domain must match /^[a-zA-Z0-9][a-zA-Z0-9-]*\\.myshopify\\.com$/.",
        },
        { status: 400 }
      );
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: "client_id and client_secret are required." },
        { status: 400 }
      );
    }

    const encryptedSecret = encryptString(clientSecret);

    if (workspaceId) {
      const { data: existing, error: existingError } = await supabase
        .from("shops")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("platform", "shopify")
        .is("uninstalled_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 500 });
      }

      if (existing?.id) {
        const { error } = await supabase
          .from("shops")
          .update({
            shop_domain: shopDomain,
            shopify_client_id: clientId,
            shopify_client_secret_encrypted: encryptedSecret,
            oauth_state: null,
            oauth_state_expires_at: null,
            workspace_id: workspaceId,
          })
          .eq("id", existing.id);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } else {
        const { error } = await supabase.from("shops").insert({
          owner_user_id: ownerUserId,
          workspace_id: workspaceId,
          platform: "shopify",
          shop_domain: shopDomain,
          shopify_client_id: clientId,
          shopify_client_secret_encrypted: encryptedSecret,
          oauth_state: null,
          oauth_state_expires_at: null,
        });
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    } else {
      const payload = {
        owner_user_id: ownerUserId,
        platform: "shopify",
        shop_domain: shopDomain,
        shopify_client_id: clientId,
        shopify_client_secret_encrypted: encryptedSecret,
        oauth_state: null,
        oauth_state_expires_at: null,
      };

      const { error } = await supabase
        .from("shops")
        .upsert(payload, { onConflict: "owner_user_id,platform,shop_domain" });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error while saving credentials.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
