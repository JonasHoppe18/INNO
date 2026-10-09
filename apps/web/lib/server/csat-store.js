import {
  CsatTemplateValidationError,
  DEFAULT_THANK_YOU_MESSAGES,
  normalizeCsatTemplateContent,
  normalizeThankYouMessages,
  renderCsatEmail,
} from "@/lib/server/csat-email";
import { createDefaultCsatEmailContent } from "@/lib/csat/email-template";

export function scopeCsatWorkspaceQuery(query, workspaceId) {
  const scope = String(workspaceId || "").trim();
  if (!scope) throw new Error("Workspace scope is required for CSAT data.");
  return query.eq("workspace_id", scope);
}

export function defaultCsatDraft(workspaceId = null) {
  return {
    id: null,
    workspace_id: workspaceId,
    name: "CSAT survey email",
    subject: "How was your support experience?",
    preview_text: "Your feedback helps us improve.",
    editor_json: createDefaultCsatEmailContent({ linkMode: "preview" }),
    rendered_html: "",
    rendered_text: "",
    status: "draft",
    version: 0,
    published_version: null,
    updated_at: null,
  };
}

export async function loadCsatDraft(serviceClient, workspaceId) {
  const { data, error } = await scopeCsatWorkspaceQuery(serviceClient
    .from("csat_email_templates")
    .select("id, workspace_id, name, subject, preview_text, editor_json, rendered_html, rendered_text, status, version, published_version, updated_at"), workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return defaultCsatDraft(workspaceId);
  return {
    ...defaultCsatDraft(workspaceId),
    ...data,
    editor_json: normalizeCsatTemplateContent(data.editor_json),
  };
}

export async function loadPublishedCsatTemplate(serviceClient, workspaceId) {
  const { data, error } = await scopeCsatWorkspaceQuery(serviceClient
    .from("csat_email_template_versions")
    .select("id, workspace_id, template_id, version, name, subject, preview_text, editor_json, rendered_html, rendered_text, published_at"), workspaceId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) return null;
  return {
    ...data,
    editor_json: normalizeCsatTemplateContent(data.editor_json),
  };
}

export async function saveCsatDraft(
  serviceClient,
  workspaceId,
  { name, subject, previewText, content, clerkUserId = null } = {}
) {
  const normalizedContent = normalizeCsatTemplateContent(content);
  const current = await loadCsatDraft(serviceClient, workspaceId);
  const nextSubject = String(subject ?? current.subject ?? "How was your support experience?").trim().slice(0, 300);
  if (!nextSubject) throw new CsatTemplateValidationError("Email subject is required.");
  const rendered = await renderCsatEmail({
    content: normalizedContent,
    subject: nextSubject,
    previewText,
    linkMode: "markers",
  });
  const row = {
    workspace_id: workspaceId,
    name: String(name || current.name || "CSAT survey email").trim().slice(0, 160),
    subject: nextSubject,
    preview_text: String(previewText || "").trim().slice(0, 300),
    editor_json: normalizedContent,
    rendered_html: rendered.html,
    rendered_text: rendered.text,
    status: "draft",
    version: Number(current.version || 0),
    published_version: current.published_version || null,
    updated_by_clerk_user_id: clerkUserId,
    updated_at: new Date().toISOString(),
  };
  const query = current.id
    ? serviceClient.from("csat_email_templates").update(row).eq("workspace_id", workspaceId).eq("id", current.id)
    : serviceClient.from("csat_email_templates").insert(row);
  const { data, error } = await query
    .select("id, workspace_id, name, subject, preview_text, editor_json, rendered_html, rendered_text, status, version, published_version, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { ...data, editor_json: normalizedContent };
}

const VERSION_COLUMNS =
  "id, workspace_id, template_id, version, name, subject, preview_text, editor_json, rendered_html, rendered_text, published_at";
const DRAFT_COLUMNS =
  "id, workspace_id, name, subject, preview_text, editor_json, rendered_html, rendered_text, status, version, published_version, updated_at";

// Archives the live version, inserts the new one and runs updateDraft; any
// failure restores the previous live version.
async function publishCsatVersion(serviceClient, workspaceId, { templateId, minVersion, fields, clerkUserId }, updateDraft) {
  const { data: latestVersion, error: latestVersionError } = await serviceClient
    .from("csat_email_template_versions")
    .select("version")
    .eq("workspace_id", workspaceId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestVersionError) throw new Error(latestVersionError.message);
  const nextVersion = Math.max(Number(latestVersion?.version || 0), Number(minVersion || 0)) + 1;

  const { data: previousPublished, error: previousPublishedError } = await serviceClient
    .from("csat_email_template_versions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "published");
  if (previousPublishedError) throw new Error(previousPublishedError.message);

  let insertedVersionId = null;
  try {
    const { error: archiveError } = await serviceClient
      .from("csat_email_template_versions")
      .update({ status: "archived" })
      .eq("workspace_id", workspaceId)
      .eq("status", "published");
    if (archiveError) throw new Error(archiveError.message);

    const { data: version, error: versionError } = await serviceClient
      .from("csat_email_template_versions")
      .insert({
        template_id: templateId,
        workspace_id: workspaceId,
        version: nextVersion,
        ...fields,
        status: "published",
        published_by_clerk_user_id: clerkUserId,
      })
      .select(VERSION_COLUMNS)
      .single();
    if (versionError) throw new Error(versionError.message);
    insertedVersionId = version.id;

    const draft = await updateDraft(nextVersion);
    return {
      draft: { ...draft, editor_json: normalizeCsatTemplateContent(draft.editor_json) },
      published: { ...version, editor_json: normalizeCsatTemplateContent(version.editor_json) },
    };
  } catch (error) {
    const rollbackErrors = [];
    if (insertedVersionId) {
      const { error: deleteError } = await serviceClient
        .from("csat_email_template_versions")
        .delete()
        .eq("id", insertedVersionId)
        .eq("workspace_id", workspaceId);
      if (deleteError) rollbackErrors.push(deleteError);
    }
    const previousIds = (previousPublished || []).map((row) => row.id).filter(Boolean);
    if (previousIds.length) {
      const { error: restoreError } = await serviceClient
        .from("csat_email_template_versions")
        .update({ status: "published" })
        .eq("workspace_id", workspaceId)
        .in("id", previousIds);
      if (restoreError) rollbackErrors.push(restoreError);
    }
    if (rollbackErrors.length) console.error("[csat-publish] Rollback failed", rollbackErrors);
    throw error;
  }
}

async function updateCsatDraftRow(serviceClient, workspaceId, draftId, values) {
  const { data, error } = await serviceClient
    .from("csat_email_templates")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", draftId)
    .select(DRAFT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function publishCsatDraft(serviceClient, workspaceId, { clerkUserId = null } = {}) {
  const draft = await loadCsatDraft(serviceClient, workspaceId);
  const rendered = await renderCsatEmail({
    content: draft.editor_json,
    subject: draft.subject,
    previewText: draft.preview_text,
    linkMode: "markers",
  });
  return publishCsatVersion(
    serviceClient,
    workspaceId,
    {
      templateId: draft.id,
      minVersion: draft.version,
      clerkUserId,
      fields: {
        name: draft.name,
        subject: draft.subject,
        preview_text: draft.preview_text,
        editor_json: draft.editor_json,
        rendered_html: rendered.html,
        rendered_text: rendered.text,
      },
    },
    (nextVersion) =>
      updateCsatDraftRow(serviceClient, workspaceId, draft.id, {
        status: "published",
        version: nextVersion,
        published_version: nextVersion,
        rendered_html: rendered.html,
        rendered_text: rendered.text,
        updated_by_clerk_user_id: clerkUserId,
      }),
  );
}

// The subject goes live at once, like the confirmation subject: the live design
// is republished with the new subject, and other draft edits stay unpublished.
export async function updateCsatSubject(serviceClient, workspaceId, { subject, clerkUserId = null } = {}) {
  const nextSubject = String(subject ?? "").trim().slice(0, 300);
  if (!nextSubject) throw new CsatTemplateValidationError("Email subject is required.");
  const draft = await loadCsatDraft(serviceClient, workspaceId);
  const published = await loadPublishedCsatTemplate(serviceClient, workspaceId);
  if (!published) {
    const saved = await saveCsatDraft(serviceClient, workspaceId, {
      name: draft.name,
      subject: nextSubject,
      previewText: draft.preview_text,
      content: draft.editor_json,
      clerkUserId,
    });
    return { draft: saved, published: null };
  }
  const rendered = await renderCsatEmail({
    content: published.editor_json,
    subject: nextSubject,
    previewText: published.preview_text,
    linkMode: "markers",
  });
  const draftWasLive = draft.status === "published";
  return publishCsatVersion(
    serviceClient,
    workspaceId,
    {
      templateId: draft.id || published.template_id,
      minVersion: draft.version,
      clerkUserId,
      fields: {
        name: published.name,
        subject: nextSubject,
        preview_text: published.preview_text,
        editor_json: published.editor_json,
        rendered_html: rendered.html,
        rendered_text: rendered.text,
      },
    },
    (nextVersion) =>
      updateCsatDraftRow(serviceClient, workspaceId, draft.id || published.template_id, {
        subject: nextSubject,
        version: nextVersion,
        published_version: nextVersion,
        ...(draftWasLive ? { status: "published", rendered_html: rendered.html, rendered_text: rendered.text } : {}),
        updated_by_clerk_user_id: clerkUserId,
      }),
  );
}

export async function loadThankYouMessages(serviceClient, workspaceId) {
  const { data, error } = await scopeCsatWorkspaceQuery(serviceClient
    .from("csat_thank_you_configs")
    .select("workspace_id, messages, updated_at"), workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return normalizeThankYouMessages(data?.messages || DEFAULT_THANK_YOU_MESSAGES);
}

export async function saveThankYouMessages(serviceClient, workspaceId, messages, clerkUserId = null) {
  const normalized = normalizeThankYouMessages(messages);
  const { data, error } = await serviceClient
    .from("csat_thank_you_configs")
    .upsert(
      {
        workspace_id: workspaceId,
        messages: normalized,
        updated_by_clerk_user_id: clerkUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    )
    .select("workspace_id, messages, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return { ...data, messages: normalizeThankYouMessages(data.messages) };
}
