import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  buildEffectiveSharedFromEmail,
  getManagedSenderFromMailbox,
} from "@/lib/server/sending-identity";

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

function accountScopeKey(account) {
  if (account?.workspace_id) return `workspace:${account.workspace_id}`;
  if (account?.user_id) return `user:${account.user_id}`;
  return null;
}

function hasSavedDomainSetup(account) {
  return Boolean(
    account?.sending_domain &&
      account?.postmark_domain_id &&
      Array.isArray(account?.domain_dns?.records) &&
      account.domain_dns.records.length,
  );
}

function domainSourceScore(account) {
  const connected = String(account?.status || "").toLowerCase() === "disconnected" ? 0 : 4;
  const verified = account?.domain_status === "verified" ? 2 : 0;
  const enabled = account?.sending_type === "custom" ? 1 : 0;
  return connected + verified + enabled;
}

async function loadMailAccounts(serviceClient, scope) {
  const { data, error } = await applyScope(
    serviceClient
      .from("mail_accounts")
      .select(
        "id, user_id, workspace_id, provider, provider_email, status, inbound_slug, shop_id, sending_type, sending_domain, postmark_domain_id, domain_status, domain_dns, from_email, from_name, metadata, updated_at"
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
    const domainSourcesByScope = new Map();
    for (const account of mailAccounts) {
      if (!hasSavedDomainSetup(account)) continue;
      const key = accountScopeKey(account);
      if (!key) continue;
      const current = domainSourcesByScope.get(key);
      const nextScore = domainSourceScore(account);
      const currentScore = current ? domainSourceScore(current) : -1;
      const nextUpdatedAt = Date.parse(account?.updated_at || 0) || 0;
      const currentUpdatedAt = Date.parse(current?.updated_at || 0) || 0;
      if (
        !current ||
        nextScore > currentScore ||
        (nextScore === currentScore && nextUpdatedAt > currentUpdatedAt)
      ) {
        domainSourcesByScope.set(key, account);
      }
    }
    const shopIds = Array.from(
      new Set(mailAccounts.map((account) => account?.shop_id).filter(Boolean))
    );
    const shopsById = new Map();
    if (shopIds.length) {
      const { data: shops, error: shopsError } = await serviceClient
        .from("shops")
        // A mailbox only needs a stable shop label for its shared sending
        // identity. Keep this lookup compatible with older workspaces while
        // the optional team_name field is being backfilled by migration.
        .select("id, shop_name, shop_domain")
        .in("id", shopIds);
      if (shopsError) throw new Error(shopsError.message);
      for (const shop of shops || []) shopsById.set(shop.id, shop);
    }
    const mailboxes = mailAccounts
      .filter((account) => account?.provider)
      .sort(
        (a, b) => (PROVIDER_ORDER[a.provider] ?? 99) - (PROVIDER_ORDER[b.provider] ?? 99)
      )
      .map((account) => {
        const managedSender = getManagedSenderFromMailbox(account);
        const inheritedDomainSource = domainSourcesByScope.get(accountScopeKey(account));
        const domainSource = hasSavedDomainSetup(account)
          ? account
          : inheritedDomainSource || account;
        return {
          id: account.id,
          provider: account.provider,
          email: account.provider_email || "",
          isActive: Boolean(account.provider_email),
          status: account.status || null,
          inboundSlug: account.inbound_slug || null,
          sendingType: domainSource.sending_type || "shared",
          sendingDomain: domainSource.sending_domain || null,
          domainStatus: domainSource.domain_status || "pending",
          domainDns: domainSource.domain_dns || null,
          fromEmail: domainSource.from_email || null,
          fromName: domainSource.from_name || null,
          domainMailboxId: domainSource.id || account.id,
          domainInherited: domainSource.id !== account.id,
          sharedFromEmail: buildEffectiveSharedFromEmail({
            shop: shopsById.get(account.shop_id) || null,
            mailbox: account,
          }),
          managedSenderStatus: managedSender?.status || "unprovisioned",
          managedSenderDomain: managedSender?.domain || null,
          managedSenderEmail: managedSender?.from_email || null,
          managedSenderDkimVerified: managedSender?.dkim_verified === true,
          managedSenderReturnPathVerified:
            managedSender?.return_path_verified === true,
        };
      });

    return NextResponse.json({ mailboxes }, { status: 200 });
  } catch (error) {
    console.error("List mail accounts failed:", error);
    // A failed lookup must not masquerade as an empty workspace. The settings
    // UI needs to distinguish "no mailboxes" from an actual server failure.
    return NextResponse.json(
      { error: "Could not load connected mailboxes." },
      { status: 500 },
    );
  }
}
