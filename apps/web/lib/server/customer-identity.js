import { normalizeEmailAddress } from "@/lib/inbox/sender";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYSTEM_LOCAL_PART_PATTERN = /^(?:no[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|notifications?)(?:[+._-]|$)/i;

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomerEmail(value) {
  const normalized = normalizeEmailAddress(value);
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export function isExternalCustomerEmail(value, { internalEmails = [], internalDomains = [] } = {}) {
  const normalized = normalizeCustomerEmail(value);
  if (!normalized) return false;

  const [localPart, domain] = normalized.split("@");
  const knownInternalEmails = new Set(
    (Array.isArray(internalEmails) ? internalEmails : [])
      .map(normalizeCustomerEmail)
      .filter(Boolean),
  );
  const knownInternalDomains = new Set(
    (Array.isArray(internalDomains) ? internalDomains : [])
      .map((candidate) => asString(candidate).toLowerCase().replace(/^@+/, ""))
      .filter(Boolean),
  );

  return !knownInternalEmails.has(normalized) &&
    !knownInternalDomains.has(domain) &&
    !SYSTEM_LOCAL_PART_PATTERN.test(localPart);
}

function customerFields({ name, phone } = {}) {
  const fields = {};
  const normalizedName = asString(name);
  const normalizedPhone = asString(phone);
  if (normalizedName) fields.name = normalizedName.slice(0, 240);
  if (normalizedPhone) fields.phone = normalizedPhone.slice(0, 80);
  return fields;
}

export async function resolveWorkspaceCustomer(
  serviceClient,
  { workspaceId, email, name = null, phone = null } = {},
) {
  const scopedWorkspaceId = asString(workspaceId);
  const normalizedEmail = normalizeCustomerEmail(email);
  if (!scopedWorkspaceId || !normalizedEmail) return null;

  const { error: upsertError } = await serviceClient
    .from("workspace_customers")
    .upsert(
      {
        workspace_id: scopedWorkspaceId,
        normalized_email: normalizedEmail,
        ...customerFields({ name, phone }),
      },
      {
        onConflict: "workspace_id,normalized_email",
        ignoreDuplicates: true,
      },
    );
  if (upsertError) throw new Error(upsertError.message);

  let { data: customer, error: customerError } = await serviceClient
    .from("workspace_customers")
    .select("id, workspace_id, normalized_email, name, phone, created_at, updated_at")
    .eq("workspace_id", scopedWorkspaceId)
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();
  if (customerError) throw new Error(customerError.message);
  if (!customer?.id) return null;

  const fields = customerFields({ name, phone });
  const updates = {};
  if (!asString(customer.name) && fields.name) updates.name = fields.name;
  if (!asString(customer.phone) && fields.phone) updates.phone = fields.phone;
  if (Object.keys(updates).length) {
    const updated = await serviceClient
      .from("workspace_customers")
      .update(updates)
      .eq("id", customer.id)
      .eq("workspace_id", scopedWorkspaceId)
      .select("id, workspace_id, normalized_email, name, phone, created_at, updated_at")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    customer = updated.data || { ...customer, ...updates };
  }

  return customer;
}

export async function loadWorkspaceInternalEmails(serviceClient, workspaceId) {
  const scopedWorkspaceId = asString(workspaceId);
  if (!scopedWorkspaceId) return [];

  const [mailboxResult, membershipResult] = await Promise.all([
    serviceClient
      .from("mail_accounts")
      .select("provider_email")
      .eq("workspace_id", scopedWorkspaceId),
    serviceClient
      .from("workspace_members")
      .select("clerk_user_id")
      .eq("workspace_id", scopedWorkspaceId),
  ]);
  if (mailboxResult.error) throw new Error(mailboxResult.error.message);
  if (membershipResult.error) throw new Error(membershipResult.error.message);

  const emails = Array.isArray(mailboxResult.data)
    ? mailboxResult.data.map((row) => row?.provider_email)
    : [];
  const clerkIds = Array.isArray(membershipResult.data)
    ? membershipResult.data.map((row) => asString(row?.clerk_user_id)).filter(Boolean)
    : [];
  if (clerkIds.length) {
    const profileResult = await serviceClient
      .from("profiles")
      .select("email")
      .in("clerk_user_id", clerkIds);
    if (profileResult.error) throw new Error(profileResult.error.message);
    if (Array.isArray(profileResult.data)) {
      emails.push(...profileResult.data.map((row) => row?.email));
    }
  }

  return Array.from(new Set(emails.map(normalizeCustomerEmail).filter(Boolean)));
}
