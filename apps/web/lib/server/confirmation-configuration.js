import {
  CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
} from "./customer-confirmation";
const asString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;
const DEFAULT_SETTING = {
  id: null,
  workspace_id: null,
  mailbox_id: null,
  enabled: false,
  include_ticket_number: true,
  subject_template: CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  body_text_template: CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
  body_html_template: "",
  template_id: null,
};

const DEFAULT_TEMPLATE = {
  id: null,
  name: "Customer confirmation template",
  html_layout: CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  plain_text_fallback: "",
};

export async function loadConfirmationConfiguration(
  serviceClient,
  workspaceId,
) {
  const [
    { data: settings, error: settingsError },
    { data: templates, error: templatesError },
    { data: mailboxes, error: mailboxesError },
  ] = await Promise.all([
    serviceClient
      .from("mail_auto_reply_settings")
      .select(
        "id, workspace_id, mailbox_id, enabled, include_ticket_number, subject_template, body_text_template, body_html_template, template_id, updated_at",
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false }),
    serviceClient
      .from("mail_auto_reply_templates")
      .select("id, name, html_layout, plain_text_fallback, updated_at")
      .eq("workspace_id", workspaceId),
    serviceClient
      .from("mail_accounts")
      .select("id, provider, provider_email, from_email, from_name, status")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (templatesError) throw new Error(templatesError.message);
  if (mailboxesError) throw new Error(mailboxesError.message);

  const rows = Array.isArray(settings) ? settings : [];
  const templatesById = new Map(
    (templates || []).map((template) => [String(template.id), template]),
  );
  const normalize = (setting, mailboxId = null) => ({
    ...DEFAULT_SETTING,
    ...(setting || {}),
    workspace_id: workspaceId,
    mailbox_id: mailboxId,
    enabled: Boolean(setting?.enabled),
    include_ticket_number: setting?.include_ticket_number !== false,
    subject_template: asString(
      setting?.subject_template,
      CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
    ),
    body_text_template: asString(
      setting?.body_text_template,
      CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
    ),
    body_html_template: asString(setting?.body_html_template),
  });
  const workspaceSetting = normalize(
    rows.find((row) => !row.mailbox_id) || null,
    null,
  );
  const workspaceTemplate =
    templatesById.get(String(workspaceSetting.template_id || "")) ||
    DEFAULT_TEMPLATE;
  const mailboxPayload = (mailboxes || []).map((mailbox) => {
    const overrideRow = rows.find(
      (row) => String(row.mailbox_id || "") === String(mailbox.id),
    );
    const override = overrideRow ? normalize(overrideRow, mailbox.id) : null;
    const effective = override || {
      ...workspaceSetting,
      mailbox_id: mailbox.id,
    };
    const effectiveTemplate =
      templatesById.get(String(effective.template_id || "")) ||
      workspaceTemplate ||
      DEFAULT_TEMPLATE;
    return {
      ...mailbox,
      inherits_workspace: !override,
      override,
      effective,
      template: effectiveTemplate,
    };
  });

  return {
    workspace_setting: workspaceSetting,
    workspace_template: workspaceTemplate,
    mailboxes: mailboxPayload,
    // Compatibility for the current UI during the coordinated web rollout.
    setting: workspaceSetting,
    template: workspaceTemplate,
  };
}
