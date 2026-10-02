import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { resolveSupabaseServerConfig } from "@/lib/server/supabase-server-config";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import { loadCustomerDirectory } from "@/lib/server/customers";
import { resolveShopifyCredentialsWithDiagnostics } from "@/lib/server/shopify-credentials";
import { ShopifyReadOnlyProvider } from "@/lib/greenfield-support/shopify-read-only";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { userId, orgId, sessionClaims } = await auth();
  if (!userId)
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  const { url, serviceKey } = resolveSupabaseServerConfig();
  if (!url || !serviceKey)
    return NextResponse.json(
      { error: "Customer data is unavailable." },
      { status: 503 },
    );
  const client = createClient(url, serviceKey);
  let scope;
  try {
    scope = await resolveAuthScope(client, {
      clerkUserId: userId,
      orgId,
      sessionClaims,
    });
    if (!scope.workspaceId)
      throw new Error("Select a workspace to view customers.");
  } catch {
    return NextResponse.json(
      { error: "Select an available workspace to view customers." },
      { status: 403 },
    );
  }
  try {
    const directory = await loadCustomerDirectory(client, scope);
    const customerId = new URL(request.url).searchParams.get("customer");
    if (!customerId) return NextResponse.json(directory);
    const customer = directory.customers.find((row) => row.id === customerId);
    if (!customer)
      return NextResponse.json(
        { error: "Customer not found." },
        { status: 404 },
      );
    if (!customer.shopId)
      return NextResponse.json({ status: "not_connected", orders: [] });
    const credentials = await resolveShopifyCredentialsWithDiagnostics(
      client,
      scope,
      {
        requestedShopId: customer.shopId,
        reason: "customers_directory",
        log: () => {},
      },
    );
    const provider = new ShopifyReadOnlyProvider({
      shopDomain: credentials.shop_domain,
      accessToken: credentials.access_token,
      customer: { email: customer.email },
      // Shopify search can return approximate matches. Require exact ownership
      // before any order is mapped or exposed to the customer profile.
      fetchImpl: async (...args) => {
        const response = await fetch(args[0], {
          ...args[1],
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return response;
        const payload = await response.json();
        if (Array.isArray(payload.orders))
          payload.orders = payload.orders.filter(
            (order) =>
              String(order.email || order.customer?.email || "")
                .trim()
                .toLowerCase() === customer.email,
          );
        return new Response(JSON.stringify(payload), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const orders = await provider.getOrderHistory(customer.email);
    return NextResponse.json({
      status: "checked",
      orders: orders.map((order) => ({
        ...order,
        adminUrl: `https://${credentials.shop_domain}/admin/orders/${encodeURIComponent(order.id)}`,
      })),
      checkedAt: new Date().toISOString(),
      limit: 50,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load customer data. Please try again." },
      { status: 502 },
    );
  }
}
