import { loadConfirmationConfiguration } from "./confirmation-configuration";
import { requireCsatWorkspace } from "./csat-route";
import { createConfirmationContent, toDesignerTokens } from "@/lib/confirmation/email-template";
import { compileConfirmationEmail } from "./confirmation-email";

export async function confirmationContext(request) {
  const context = await requireCsatWorkspace();
  if (context.response) return context;
  const mailboxId = new URL(request.url).searchParams.get("mailbox_id") || null;
  const configuration = await loadConfirmationConfiguration(
    context.serviceClient,
    context.workspaceId,
  );
  const mailbox = mailboxId
    ? configuration.mailboxes.find((row) => row.id === mailboxId)
    : null;
  if (mailboxId && !mailbox)
    return {
      response: Response.json(
        { error: "Mailbox not found in this workspace." },
        { status: 404 },
      ),
    };
  return {
    ...context,
    mailboxId,
    scopeKey: mailboxId || "workspace",
    setting: mailbox?.effective || configuration.workspace_setting,
  };
}
export async function loadConfirmationDraft(context) {
  const { data, error } = await context.serviceClient
    .from("confirmation_email_drafts")
    .select("*")
    .eq("workspace_id", context.workspaceId)
    .eq("scope_key", context.scopeKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data || {
      id: null,
      name: "Customer confirmation",
      subject: toDesignerTokens(context.setting.subject_template),
      preview_text: "",
      editor_json: createConfirmationContent(
        context.setting.body_text_template,
      ),
      status: "draft",
      version: 0,
      published_version: null,
    }
  );
}
export async function saveConfirmationDraft(context, body) {
  const compiled = await compileConfirmationEmail({
    content: body.editor_json,
    subject: body.subject,
    previewText: body.preview_text,
  });
  const { data, error } = await context.serviceClient
    .from("confirmation_email_drafts")
    .upsert(
      {
        workspace_id: context.workspaceId,
        mailbox_id: context.mailboxId,
        name: String(body.name || "Customer confirmation").slice(0, 200),
        subject: String(body.subject).slice(0, 300),
        preview_text: String(body.preview_text || "").slice(0, 300),
        editor_json: compiled.content,
        status: "draft",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,scope_key" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
// Keeps a saved designer draft in step when Settings edits the live subject,
// without changing its draft/published status.
export async function syncConfirmationDraftSubject(context, subject) {
  const { error } = await context.serviceClient
    .from("confirmation_email_drafts")
    .update({ subject: String(subject || "").slice(0, 300), updated_at: new Date().toISOString() })
    .eq("workspace_id", context.workspaceId)
    .eq("scope_key", context.scopeKey);
  if (error) throw new Error(error.message);
}
export async function publishConfirmationDraft(context) {
  const draft = await loadConfirmationDraft(context);
  if (!draft.id) throw new Error("Save the email draft before publishing.");
  const compiled = await compileConfirmationEmail({
    content: draft.editor_json,
    subject: draft.subject,
    previewText: draft.preview_text,
  });
  const { data, error } = await context.serviceClient.rpc(
    "publish_confirmation_email",
    {
      p_workspace_id: context.workspaceId,
      p_draft_id: draft.id,
      p_expected_updated_at: draft.updated_at,
      p_subject: compiled.subject,
      p_body_text: compiled.text,
      p_html_layout: compiled.html,
    },
  );
  if (error) throw new Error(error.message);
  return data;
}
