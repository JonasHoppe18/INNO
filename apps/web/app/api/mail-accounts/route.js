import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const PROVIDER_ORDER = { gmail: 0, outlook: 1, smtp: 2 };

async function loadMailAccounts(serviceClient, scope) {
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select(
        "id, provider, provider_email, status, inbound_slug, sending_type, sending_domain, domain_status, domain_dns, from_email, from_name"
      )
      .in("provider", ["gmail", "outlook", "smtp"])
      .order("created_at", { ascending: true }),
    scope
  );
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

// Client-fetchable equivalent of app/(dashboard)/mailboxes/page.jsx's server-side
// load + shape, so the Settings page (a client component) can render the same
// mailbox list without duplicating query/shaping logic in two places long-term —
// this route is the single source, the settings tab and the standalone
// /mailboxes page both consume it going forward.
export async function GET() {
  try {
    const { userId: clerkUserId, orgId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = createServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId && !scope.supabaseUserId) {
      return NextResponse.json({ mailboxes: [] }, { status: 200 });
    }

    const mailAccounts = await loadMailAccounts(serviceClient, scope);
    const mailboxes = mailAccounts
      .filter((account) => account?.provider)
      .sort(
        (a, b) => (PROVIDER_ORDER[a.provider] ?? 99) - (PROVIDER_ORDER[b.provider] ?? 99)
      )
      .map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.provider_email || "",
        isActive: Boolean(account.provider_email),
        status: account.status || null,
        inboundSlug: account.inbound_slug || null,
        sendingType: account.sending_type || "shared",
        sendingDomain: account.sending_domain || null,
        domainStatus: account.domain_status || "pending",
        domainDns: account.domain_dns || null,
        fromEmail: account.from_email || null,
        fromName: account.from_name || null,
      }));

    return NextResponse.json({ mailboxes }, { status: 200 });
  } catch (error) {
    console.error("List mail accounts failed:", error);
    return NextResponse.json({ mailboxes: [] }, { status: 200 });
  }
}
