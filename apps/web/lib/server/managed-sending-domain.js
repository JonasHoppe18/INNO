import {
  createPostmarkDomain,
  findPostmarkDomainByName,
  getPostmarkDomain,
  isPostmarkDomainVerified,
} from "@/lib/server/postmark";
import { toGoDaddyRecordName, upsertGoDaddyDnsRecord } from "@/lib/server/godaddy-dns";
import {
  getManagedSenderFromMailbox,
  shopLabelSource,
  slugifyDomainLabel,
} from "@/lib/server/sending-identity";

const MANAGED_ROOT_DOMAIN = String(
  process.env.GODADDY_DOMAIN || process.env.SONA_SHARED_SENDING_DOMAIN || "sona-ai.dk",
)
  .trim()
  .toLowerCase()
  .replace(/^\.+|\.+$/g, "");
const MANAGED_FROM_LOCAL_PART = slugifyDomainLabel(
  process.env.SONA_MANAGED_FROM_LOCAL_PART || "kundeservice",
  "kundeservice",
);

const nowIso = () => new Date().toISOString();

function mailboxMetadata(mailbox) {
  return mailbox?.metadata && typeof mailbox.metadata === "object" ? mailbox.metadata : {};
}

async function persistManagedSender(serviceClient, mailbox, managedSender) {
  const metadata = {
    ...mailboxMetadata(mailbox),
    managed_sender: managedSender,
  };
  const { data, error } = await serviceClient
    .from("mail_accounts")
    .update({ metadata, updated_at: nowIso() })
    .eq("id", mailbox.id)
    .select("metadata")
    .maybeSingle();
  if (error) throw new Error(error.message);
  mailbox.metadata = data?.metadata || metadata;
  return getManagedSenderFromMailbox(mailbox);
}

async function logProvisioning(serviceClient, stepName, status, detail) {
  try {
    await serviceClient.from("agent_logs").insert({
      draft_id: null,
      step_name: stepName,
      step_detail: JSON.stringify(detail),
      status,
      created_at: nowIso(),
    });
  } catch {
    // Provisioning logs are best-effort and must never block sending.
  }
}

function buildPostmarkDnsRecords(domainPayload) {
  const dkimHost =
    domainPayload?.DKIMPendingHost || domainPayload?.DKIMHost || "";
  const dkimValue =
    domainPayload?.DKIMPendingTextValue || domainPayload?.DKIMTextValue || "";
  const returnPathHost = domainPayload?.ReturnPathDomain || "";
  const returnPathValue = domainPayload?.ReturnPathDomainCNAMEValue || "";
  const records = [];
  if (dkimHost && dkimValue) {
    records.push({ type: "TXT", host: dkimHost, value: dkimValue });
  }
  if (returnPathHost && returnPathValue) {
    records.push({ type: "CNAME", host: returnPathHost, value: returnPathValue });
  }
  if (records.length !== 2) {
    throw new Error("Postmark did not return the required DKIM and Return-Path records.");
  }
  return records;
}

async function chooseManagedSlug(serviceClient, mailbox, shop) {
  const source = shopLabelSource(shop || {}, mailbox || {});
  const base = slugifyDomainLabel(source, "webshop").slice(0, 48) || "webshop";
  const candidateDomain = `${base}.${MANAGED_ROOT_DOMAIN}`;
  const { data, error } = await serviceClient
    .from("mail_accounts")
    .select("id")
    .contains("metadata", { managed_sender: { domain: candidateDomain } })
    .neq("id", mailbox.id)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!Array.isArray(data) || data.length === 0) return base;
  const suffix = String(mailbox?.workspace_id || mailbox?.id || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 6)
    .toLowerCase();
  return `${base.slice(0, Math.max(1, 48 - suffix.length - 1))}-${suffix || "shop"}`;
}

async function refreshManagedSender(serviceClient, mailbox, managedSender) {
  const domainPayload = await getPostmarkDomain(managedSender.postmark_domain_id);
  const status = isPostmarkDomainVerified(domainPayload) ? "verified" : "pending";
  return await persistManagedSender(serviceClient, mailbox, {
    ...managedSender,
    status,
    error: null,
    dkim_verified: Boolean(domainPayload?.DKIMVerified),
    return_path_verified: Boolean(domainPayload?.ReturnPathDomainVerified),
    updated_at: nowIso(),
  });
}

export async function ensureManagedSendingDomain({
  serviceClient,
  mailbox,
  shop = null,
  refreshPending = false,
}) {
  if (!serviceClient || !mailbox?.id || mailbox?.provider !== "smtp") return null;
  const current = getManagedSenderFromMailbox(mailbox);
  if (mailbox?.sending_type === "custom" && mailbox?.domain_status === "verified") {
    return current;
  }
  if (current?.status === "verified") return current;
  if (current?.postmark_domain_id && current?.status === "pending") {
    if (!refreshPending) return current;
    return await refreshManagedSender(serviceClient, mailbox, current);
  }

  const slug = current?.slug || (await chooseManagedSlug(serviceClient, mailbox, shop));
  const domain = current?.domain || `${slug}.${MANAGED_ROOT_DOMAIN}`;
  const fromEmail = `${MANAGED_FROM_LOCAL_PART}@${domain}`;
  const provisioning = {
    ...current,
    slug,
    domain,
    from_email: fromEmail,
    status: "provisioning",
    error: null,
    updated_at: nowIso(),
  };
  await persistManagedSender(serviceClient, mailbox, provisioning);

  try {
    let postmarkDomain = await findPostmarkDomainByName(domain);
    if (postmarkDomain?.ID) {
      postmarkDomain = await getPostmarkDomain(postmarkDomain.ID);
    } else {
      postmarkDomain = await createPostmarkDomain({
        domainName: domain,
        returnPathDomain: `pm-bounces.${domain}`,
      });
    }

    const dnsRecords = buildPostmarkDnsRecords(postmarkDomain);
    await Promise.all(
      dnsRecords.map((record) =>
        upsertGoDaddyDnsRecord({
          zoneDomain: MANAGED_ROOT_DOMAIN,
          type: record.type,
          name: toGoDaddyRecordName(record.host, MANAGED_ROOT_DOMAIN),
          value: record.value,
          ttl: 600,
        }),
      ),
    );

    const domainDetails = await getPostmarkDomain(postmarkDomain.ID);
    const managedSender = await persistManagedSender(serviceClient, mailbox, {
      ...provisioning,
      postmark_domain_id: String(postmarkDomain.ID),
      status: isPostmarkDomainVerified(domainDetails) ? "verified" : "pending",
      dns_records: dnsRecords,
      dkim_verified: Boolean(domainDetails?.DKIMVerified),
      return_path_verified: Boolean(domainDetails?.ReturnPathDomainVerified),
      updated_at: nowIso(),
    });
    await logProvisioning(serviceClient, "managed_sending_domain_provisioned", "success", {
      mailbox_id: mailbox.id,
      domain,
      status: managedSender?.status || "pending",
    });
    return managedSender;
  } catch (error) {
    const message = String(error?.message || "Managed sender provisioning failed.").slice(0, 280);
    await persistManagedSender(serviceClient, mailbox, {
      ...provisioning,
      status: "error",
      error: message,
      updated_at: nowIso(),
    }).catch(() => null);
    await logProvisioning(serviceClient, "managed_sending_domain_provision_failed", "error", {
      mailbox_id: mailbox.id,
      domain,
      error: message,
    });
    throw new Error(message);
  }
}
