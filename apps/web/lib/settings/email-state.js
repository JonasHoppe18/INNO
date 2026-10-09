import { CUSTOMER_CONFIRMATION_DEFAULT_TEXT } from "@/lib/server/customer-confirmation";
import { resourcePayload } from "@/lib/settings/resource-map";
import { normalizeBlocklistRows, normalizeRoutingRows, normalizeSenderRuleRows } from "@/lib/settings/email-rows";

export const DEFAULT_CONFIRMATION_SUBJECT = "We've received your message";
export const DEFAULT_CONFIRMATION_BODY_TEXT = CUSTOMER_CONFIRMATION_DEFAULT_TEXT;
export const DEFAULT_CONFIRMATION_TEMPLATE_HTML =
  "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>";

export function initialEmailState(resources, requestedMailboxId) {
  const state = {
    confirmationConfiguration: null,
    selectedConfirmationMailboxId: "",
    autoReplyInheritsWorkspace: false,
    autoReplyEnabled: false,
    autoReplyIncludeTicketNumber: true,
    autoReplySubjectTemplate: DEFAULT_CONFIRMATION_SUBJECT,
    autoReplyBodyTextTemplate: DEFAULT_CONFIRMATION_BODY_TEXT,
    autoReplyBodyHtmlTemplate: "",
    autoReplyTemplateId: null,
    autoReplyTemplateName: "Default template",
    autoReplyTemplateHtml: DEFAULT_CONFIRMATION_TEMPLATE_HTML,
    emailRoutingRows: normalizeRoutingRows([]),
    emailSenderRuleRows: normalizeSenderRuleRows([]),
    emailBlocklistRows: normalizeBlocklistRows([]),
    workspaceInboxesForRules: [],
  };

  const autoReply = resourcePayload(resources, "/api/settings/auto-reply");
  if (autoReply) {
    const requestedMailbox = (autoReply.mailboxes || []).find((mailbox) => mailbox.id === requestedMailboxId);
    const setting = requestedMailbox?.effective || autoReply.workspace_setting || autoReply.setting || {};
    const template = requestedMailbox?.template || autoReply.workspace_template || autoReply.template || {};
    Object.assign(state, {
      confirmationConfiguration: autoReply || null,
      selectedConfirmationMailboxId: requestedMailbox?.id || "",
      autoReplyInheritsWorkspace: Boolean(requestedMailbox?.inherits_workspace),
      autoReplyEnabled: Boolean(setting?.enabled),
      autoReplyIncludeTicketNumber: setting?.include_ticket_number !== false,
      autoReplySubjectTemplate: String(setting?.subject_template || DEFAULT_CONFIRMATION_SUBJECT),
      autoReplyBodyTextTemplate: String(setting?.body_text_template || DEFAULT_CONFIRMATION_BODY_TEXT),
      autoReplyBodyHtmlTemplate: String(setting?.body_html_template || ""),
      autoReplyTemplateId: template?.id || setting?.template_id || null,
      autoReplyTemplateName: String(template?.name || "Default template"),
      autoReplyTemplateHtml: String(template?.html_layout || DEFAULT_CONFIRMATION_TEMPLATE_HTML),
    });
  }

  const routes = resourcePayload(resources, "/api/settings/email-routing")?.routes;
  if (Array.isArray(routes)) state.emailRoutingRows = normalizeRoutingRows(routes);
  const rules = resourcePayload(resources, "/api/settings/email-sender-rules")?.rules;
  if (Array.isArray(rules)) state.emailSenderRuleRows = normalizeSenderRuleRows(rules);
  const blocks = resourcePayload(resources, "/api/settings/email-blocklist")?.blocks;
  if (Array.isArray(blocks)) state.emailBlocklistRows = normalizeBlocklistRows(blocks);
  const inboxes = resourcePayload(resources, "/api/inboxes")?.inboxes;
  if (Array.isArray(inboxes)) state.workspaceInboxesForRules = inboxes;
  return state;
}
