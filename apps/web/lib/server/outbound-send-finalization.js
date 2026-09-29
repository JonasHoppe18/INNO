import crypto from "crypto";
import { applyScope } from "@/lib/server/workspace-auth";
import { isUniqueViolation } from "@/lib/server/outbound-send-attempts";

const MESSAGE_SELECT =
  "id, thread_id, mailbox_id, provider, provider_message_id, is_draft";

function normalized(value) {
  return String(value ?? "").trim();
}

export function buildOutboundAttachmentKey(attachment, ordinal) {
  const canonical = JSON.stringify({
    ordinal: Number(ordinal) || 0,
    filename: normalized(attachment?.filename),
    mime_type: normalized(attachment?.mime_type).toLowerCase(),
    size_bytes: Number(attachment?.size_bytes || 0),
    is_inline: attachment?.is_inline === true,
    content_id: normalized(attachment?.content_id),
    content_sha256: crypto
      .createHash("sha256")
      .update(normalized(attachment?.content_base64))
      .digest("hex"),
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function buildOutboundAttachmentRows({
  attachments,
  userId,
  mailboxId,
  messageId,
  provider,
  nowIso,
}) {
  return (Array.isArray(attachments) ? attachments : []).map((attachment, ordinal) => ({
    user_id: userId,
    mailbox_id: mailboxId,
    message_id: messageId,
    provider,
    provider_attachment_id: attachment?.is_inline
      ? attachment?.content_id || null
      : null,
    attachment_key: buildOutboundAttachmentKey(attachment, ordinal),
    filename: attachment.filename,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    storage_path: `inline:${attachment.mime_type};base64,${normalized(
      attachment.content_base64,
    )}`,
    created_at: nowIso,
  }));
}

export async function loadOutboundConversationMessage(
  serviceClient,
  scope,
  {
    messageId = null,
    mailboxId,
    threadId,
    provider,
    providerMessageId = null,
  },
) {
  let query = serviceClient
    .from("mail_messages")
    .select(MESSAGE_SELECT)
    .eq("mailbox_id", mailboxId)
    .eq("thread_id", threadId)
    .eq("provider", provider)
    .eq("from_me", true)
    .eq("is_draft", false)
    .limit(1);
  if (messageId) query = query.eq("id", messageId);
  else if (providerMessageId) {
    query = query.eq("provider_message_id", providerMessageId);
  } else {
    return null;
  }
  query = applyScope(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function persistOutboundConversationMessage({
  serviceClient,
  scope,
  draftMessage,
  userId,
  mailbox,
  threadId,
  subject,
  snippet,
  persistedBodyText,
  finalBodyHtml,
  persistedBodyHtml,
  sentFromName,
  sentFromEmail,
  deliveryTo,
  deliveryCc,
  deliveryBcc,
  persistedProviderMessageId,
  nowIso,
}) {
  const existingMessage = await loadOutboundConversationMessage(
    serviceClient,
    scope,
    {
      mailboxId: mailbox.id,
      threadId,
      provider: mailbox.provider,
      providerMessageId: persistedProviderMessageId,
    },
  );
  if (existingMessage?.id) return existingMessage.id;

  const fields = {
    provider: mailbox.provider,
    provider_message_id: persistedProviderMessageId,
    subject,
    snippet,
    body_text: persistedBodyText,
    body_html: finalBodyHtml || persistedBodyHtml || null,
    clean_body_text: persistedBodyText,
    clean_body_html: persistedBodyHtml || null,
    quoted_body_text: null,
    quoted_body_html: null,
    from_name: sentFromName,
    from_email: sentFromEmail,
    from_me: true,
    to_emails: deliveryTo,
    cc_emails: deliveryCc,
    bcc_emails: deliveryBcc,
    is_read: true,
    sent_at: nowIso,
    received_at: null,
    is_draft: false,
    ai_draft_text: null,
    updated_at: nowIso,
  };

  if (draftMessage?.id) {
    let updateQuery = serviceClient
      .from("mail_messages")
      .update(fields)
      .eq("id", draftMessage.id)
      .eq("thread_id", threadId)
      .eq("from_me", true)
      .eq("is_draft", true);
    updateQuery = applyScope(updateQuery, scope);
    const { data, error } = await updateQuery.select("id").maybeSingle();
    if (!error && data?.id) return data.id;
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
  }

  const { data, error } = await serviceClient
    .from("mail_messages")
    .insert({
      id: crypto.randomUUID(),
      user_id: userId,
      workspace_id: scope?.workspaceId || null,
      mailbox_id: mailbox.id,
      thread_id: threadId,
      created_at: nowIso,
      ...fields,
    })
    .select("id")
    .maybeSingle();
  if (!error && data?.id) return data.id;
  if (error && !isUniqueViolation(error)) throw new Error(error.message);

  const convergedMessage = await loadOutboundConversationMessage(
    serviceClient,
    scope,
    {
      mailboxId: mailbox.id,
      threadId,
      provider: mailbox.provider,
      providerMessageId: persistedProviderMessageId,
    },
  );
  if (convergedMessage?.id) return convergedMessage.id;
  throw new Error("Could not converge on the sent conversation message.");
}

async function verifyAttachmentSet({
  serviceClient,
  mailboxId,
  messageId,
  expectedKeys,
}) {
  let query = serviceClient
    .from("mail_attachments")
    .select("attachment_key")
    .eq("mailbox_id", mailboxId)
    .eq("message_id", messageId)
    .not("attachment_key", "is", null);
  // mail_attachments has no workspace_id. The exact message_id/mailbox_id
  // pair was loaded through the workspace-scoped mail_messages query before
  // this helper is called, so do not narrow a shared-workspace retry to the
  // member who originally created the message.
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const actualKeys = new Set(
    (Array.isArray(data) ? data : [])
      .map((row) => row?.attachment_key)
      .filter(Boolean),
  );
  return expectedKeys.every((key) => actualKeys.has(key));
}

export async function persistOutboundAttachments({
  serviceClient,
  attachments,
  userId,
  mailboxId,
  messageId,
  provider,
  nowIso,
}) {
  let deleteQuery = serviceClient
    .from("mail_attachments")
    .delete()
    .eq("mailbox_id", mailboxId)
    .eq("message_id", messageId);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Error(deleteError.message);

  const rows = buildOutboundAttachmentRows({
    attachments,
    userId,
    mailboxId,
    messageId,
    provider,
    nowIso,
  });
  if (!rows.length) return;

  const { error: insertError } = await serviceClient
    .from("mail_attachments")
    .insert(rows);
  if (!insertError) return;
  if (!isUniqueViolation(insertError)) throw new Error(insertError.message);

  const complete = await verifyAttachmentSet({
    serviceClient,
    mailboxId,
    messageId,
    expectedKeys: rows.map((row) => row.attachment_key),
  });
  if (!complete) throw new Error("Could not converge on the sent attachment set.");
}
