const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYSTEM_LOCAL_PART_PATTERN = /^(?:no[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|notifications?)(?:[+._-]|$)/i;

type CustomerClient = {
  from: (table: string) => any;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCustomerEmail(value: unknown): string {
  const text = asString(value);
  if (!text) return "";
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const normalized = (match?.[0] || text).trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export function isExternalCustomerEmail(
  value: unknown,
  options: { internalEmails?: unknown[]; internalDomains?: unknown[] } = {},
): boolean {
  const normalized = normalizeCustomerEmail(value);
  if (!normalized) return false;

  const [localPart, domain] = normalized.split("@");
  const internalEmails = new Set(
    (Array.isArray(options.internalEmails) ? options.internalEmails : [])
      .map(normalizeCustomerEmail)
      .filter(Boolean),
  );
  const internalDomains = new Set(
    (Array.isArray(options.internalDomains) ? options.internalDomains : [])
      .map((candidate) => asString(candidate).toLowerCase().replace(/^@+/, ""))
      .filter(Boolean),
  );
  return !internalEmails.has(normalized) &&
    !internalDomains.has(domain) &&
    !SYSTEM_LOCAL_PART_PATTERN.test(localPart);
}

function customerFields(input: { name?: unknown; phone?: unknown } = {}): Record<string, string> {
  const fields: Record<string, string> = {};
  const name = asString(input.name);
  const phone = asString(input.phone);
  if (name) fields.name = name.slice(0, 240);
  if (phone) fields.phone = phone.slice(0, 80);
  return fields;
}

export async function resolveWorkspaceCustomer(
  supabase: CustomerClient,
  input: { workspaceId?: unknown; email?: unknown; name?: unknown; phone?: unknown } = {},
) {
  const workspaceId = asString(input.workspaceId);
  const normalizedEmail = normalizeCustomerEmail(input.email);
  if (!workspaceId || !normalizedEmail) return null;

  const { error: upsertError } = await supabase
    .from("workspace_customers")
    .upsert(
      {
        workspace_id: workspaceId,
        normalized_email: normalizedEmail,
        ...customerFields(input),
      },
      { onConflict: "workspace_id,normalized_email", ignoreDuplicates: true },
    );
  if (upsertError) throw new Error(upsertError.message);

  let { data: customer, error } = await supabase
    .from("workspace_customers")
    .select("id, workspace_id, normalized_email, name, phone, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!customer?.id) return null;

  const fields = customerFields(input);
  const updates: Record<string, string> = {};
  if (!asString(customer.name) && fields.name) updates.name = fields.name;
  if (!asString(customer.phone) && fields.phone) updates.phone = fields.phone;
  if (Object.keys(updates).length) {
    const updated = await supabase
      .from("workspace_customers")
      .update(updates)
      .eq("id", customer.id)
      .eq("workspace_id", workspaceId)
      .select("id, workspace_id, normalized_email, name, phone, created_at, updated_at")
      .maybeSingle();
    if (updated.error) throw new Error(updated.error.message);
    customer = updated.data || { ...customer, ...updates };
  }
  return customer;
}

export async function loadWorkspaceInternalEmails(
  supabase: CustomerClient,
  workspaceId: unknown,
): Promise<string[]> {
  const scopedWorkspaceId = asString(workspaceId);
  if (!scopedWorkspaceId) return [];

  const [mailboxes, members] = await Promise.all([
    supabase.from("mail_accounts").select("provider_email").eq("workspace_id", scopedWorkspaceId),
    supabase.from("workspace_members").select("clerk_user_id").eq("workspace_id", scopedWorkspaceId),
  ]);
  if (mailboxes.error) throw new Error(mailboxes.error.message);
  if (members.error) throw new Error(members.error.message);

  const emails = Array.isArray(mailboxes.data)
    ? mailboxes.data.map((row: any) => row?.provider_email)
    : [];
  const clerkIds = Array.isArray(members.data)
    ? members.data.map((row: any) => asString(row?.clerk_user_id)).filter(Boolean)
    : [];
  if (clerkIds.length) {
    const profiles = await supabase.from("profiles").select("email").in("clerk_user_id", clerkIds);
    if (profiles.error) throw new Error(profiles.error.message);
    if (Array.isArray(profiles.data)) emails.push(...profiles.data.map((row: any) => row?.email));
  }
  return Array.from(new Set(emails.map(normalizeCustomerEmail).filter(Boolean)));
}

export function resolveInboundCustomerIdentity(input: {
  workspaceId?: unknown;
  fromEmail?: unknown;
  extractedCustomerEmail?: unknown;
  isBlockedSender?: boolean;
  isAutomated?: boolean;
  internalEmails?: unknown[];
}) {
  const email = input.extractedCustomerEmail || input.fromEmail;
  if (input.isBlockedSender || input.isAutomated) return null;
  if (!input.workspaceId || !isExternalCustomerEmail(email, { internalEmails: input.internalEmails })) {
    return null;
  }
  return {
    workspaceId: asString(input.workspaceId),
    normalizedEmail: normalizeCustomerEmail(email),
  };
}
