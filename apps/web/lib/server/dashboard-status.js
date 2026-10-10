import { applyScope } from "@/lib/server/workspace-auth";

// System status for the Dashboard. Only signals the app already trusts are
// used: the Mailboxes page's connected rule and whether a store is installed.
// Sending and drafting have no reliable health signal yet, so they are not shown.

function mailboxConnected(mailbox) {
  const status = String(mailbox?.status || "").trim().toLowerCase();
  // Same rule as components/mailboxes/MailboxRow.jsx: forwarding mailboxes are
  // connected unless disconnected; inbox-connected ones must be active.
  if (String(mailbox?.provider || "").toLowerCase() === "smtp") return status !== "disconnected";
  return status === "active";
}

export function buildSystemStatus({ mailboxes = [], shops = [] }) {
  const checks = [];
  if (mailboxes.length) {
    const broken = mailboxes.filter((mailbox) => !mailboxConnected(mailbox));
    checks.push({
      key: "mailbox",
      label: mailboxes.length === 1 ? "Mailbox" : "Mailboxes",
      ok: broken.length === 0,
      detail: broken.length
        ? `${broken[0].provider_email || "A mailbox"}${broken.length > 1 ? ` and ${broken.length - 1} more` : ""} disconnected`
        : "Receiving mail",
      href: "/mailboxes",
      action: "Reconnect",
    });
  }
  if (shops.length) {
    const installed = shops.some((shop) => !shop.uninstalled_at);
    checks.push({
      key: "store",
      label: "Connected store",
      ok: installed,
      detail: installed ? "Connected" : "Disconnected",
      href: "/integrations",
      action: "Reconnect",
    });
  }
  return { healthy: checks.every((check) => check.ok), checks };
}

export async function loadSystemStatus(serviceClient, scope) {
  const [mailboxes, shops] = await Promise.all([
    applyScope(serviceClient.from("mail_accounts").select("id, provider, provider_email, status"), scope),
    applyScope(serviceClient.from("shops").select("id, uninstalled_at"), scope, { userColumn: "owner_user_id" }),
  ]);
  if (mailboxes.error) throw new Error(mailboxes.error.message);
  if (shops.error) throw new Error(shops.error.message);
  return buildSystemStatus({ mailboxes: mailboxes.data || [], shops: shops.data || [] });
}
