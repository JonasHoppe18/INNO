import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { buildDomainDns, createPostmarkDomain } from "@/lib/server/postmark";

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

async function resolveSupabaseUserId(serviceClient, clerkUserId) {
  const { data, error } = await serviceClient
    .from("profiles")
    .select("user_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

async function logAgentStatus(serviceClient, stepName, status, detail) {
  await serviceClient.from("agent_logs").insert({
    draft_id: null,
    step_name: stepName,
    step_detail: JSON.stringify(detail),
    status,
    created_at: new Date().toISOString(),
  });
}

function normalizeDomain(input) {
  return String(input || "").trim().toLowerCase().replace(/\.$/, "");
}

function isValidDomain(domain) {
  if (!domain) return false;
  if (domain.includes("://") || domain.includes("/") || domain.includes("@")) return false;
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseEmailDomain(email) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === email.length - 1) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request, { params }) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const mailboxId = params?.id;
  if (!mailboxId) {
    return NextResponse.json({ error: "Mailbox id is required." }, { status: 400 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Supabase service configuration is missing." },
      { status: 500 }
    );
  }

  let supabaseUserId = null;
  try {
    supabaseUserId = await resolveSupabaseUserId(serviceClient, userId);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!supabaseUserId) {
    return NextResponse.json({ error: "Supabase user not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const domain = normalizeDomain(body?.domain);
  if (!isValidDomain(domain)) {
    return NextResponse.json(
      { error: "Please enter a valid domain like company.com (without protocol or path)." },
      { status: 400 }
    );
  }

  const rawFromEmail = normalizeEmail(body?.from_email || `support@${domain}`);
  if (!isValidEmail(rawFromEmail)) {
    return NextResponse.json({ error: "from_email must be a valid email." }, { status: 400 });
  }
  if (parseEmailDomain(rawFromEmail) !== domain) {
    return NextResponse.json(
      { error: "from_email must use the same domain you are verifying." },
      { status: 400 }
    );
  }

  const fromName = String(body?.from_name || "").trim() || null;

  const { data: mailbox, error: mailboxError } = await serviceClient
    .from("mail_accounts")
    .select("id, user_id, provider")
    .eq("id", mailboxId)
    .eq("user_id", supabaseUserId)
    .maybeSingle();

  if (mailboxError || !mailbox) {
    return NextResponse.json({ error: "Mailbox not found." }, { status: 404 });
  }
  if (mailbox.provider !== "smtp") {
    return NextResponse.json(
      { error: "Custom sending domains are only available for forwarded mailboxes." },
      { status: 400 }
    );
  }

  const returnPathDomain = `pm-bounces.${domain}`;

  await logAgentStatus(serviceClient, "postmark_domain_setup_started", "info", {
    mailbox_id: mailboxId,
    domain,
  });

  try {
    const postmarkDomain = await createPostmarkDomain({
      domainName: domain,
      returnPathDomain,
    });

    const domainDns = buildDomainDns(domain, postmarkDomain);
    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await serviceClient
      .from("mail_accounts")
      .update({
        sending_type: "custom",
        sending_domain: domain,
        postmark_domain_id: String(postmarkDomain?.ID || ""),
        domain_status: "pending",
        domain_dns: domainDns,
        from_email: rawFromEmail,
        from_name: fromName,
        updated_at: nowIso,
      })
      .eq("id", mailboxId)
      .eq("user_id", supabaseUserId)
      .select("domain_status, from_email, domain_dns")
      .maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json(
      {
        domain_status: updated?.domain_status || "pending",
        from_email: updated?.from_email || rawFromEmail,
        domain_dns: updated?.domain_dns || domainDns,
      },
      { status: 200 }
    );
  } catch (error) {
    const safeError = String(error?.message || "Domain setup failed.").slice(0, 280);

    await logAgentStatus(serviceClient, "postmark_domain_setup_failed", "error", {
      mailbox_id: mailboxId,
      domain,
      error: safeError,
    });

    await serviceClient
      .from("mail_accounts")
      .update({ domain_status: "error", updated_at: new Date().toISOString() })
      .eq("id", mailboxId)
      .eq("user_id", supabaseUserId);

    return NextResponse.json({ error: safeError }, { status: 400 });
  }
}
