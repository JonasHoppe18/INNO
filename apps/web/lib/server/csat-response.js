import { sendPostmarkEmail } from "@/lib/server/postmark";
import { buildEffectiveSharedFromEmail } from "@/lib/server/sending-identity";
import {
  buildCsatResponseUrl,
  createCsatToken,
  hashCsatToken,
  isValidCsatScore,
  renderCsatEmail,
  selectThankYouMessage,
} from "@/lib/server/csat-email";
import { loadPublishedCsatTemplate, loadThankYouMessages } from "@/lib/server/csat-store";

const FALLBACK_FROM_EMAIL = process.env.POSTMARK_FROM_EMAIL || "support@sona-ai.dk";
const FALLBACK_FROM_NAME = process.env.POSTMARK_FROM_NAME || "Sona Support";

export async function issueCsatSurveyToken(
  serviceClient,
  { workspaceId, threadId, expiresAt = null, testMode = false } = {}
) {
  if (!workspaceId || !threadId) throw new Error("Workspace and conversation are required for a CSAT token.");
  const token = createCsatToken();
  const { data, error } = await serviceClient
    .from("csat_survey_tokens")
    .upsert(
      {
        workspace_id: workspaceId,
        thread_id: threadId,
        token_hash: hashCsatToken(token),
        expires_at: expiresAt,
        test_mode: Boolean(testMode),
        consumed_at: null,
      },
      { onConflict: "workspace_id,thread_id" }
    )
    .select("id, workspace_id, thread_id, expires_at, test_mode")
    .single();
  if (error) throw new Error(error.message);
  return { ...data, token, response_url: buildCsatResponseUrl(token, 1) };
}

export async function recordCsatResponse(serviceClient, { token, score } = {}) {
  if (!token) return { ok: false, reason: "missing_token" };
  if (!isValidCsatScore(score)) return { ok: false, reason: "invalid_score" };
  const tokenHash = hashCsatToken(token);
  if (!tokenHash) return { ok: false, reason: "missing_token" };

  const { data: tokenRow, error: tokenError } = await serviceClient
    .from("csat_survey_tokens")
    .select("id, workspace_id, thread_id, expires_at, consumed_at, test_mode")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (tokenError) throw new Error(tokenError.message);
  if (!tokenRow?.id || tokenRow.test_mode) return { ok: false, reason: "invalid_token" };
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired_token" };
  }

  const { data: existing, error: existingError } = await serviceClient
    .from("support_feedback")
    .select("score")
    .eq("thread_id", tokenRow.thread_id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (!existing?.score) {
    const { error: insertError } = await serviceClient
      .from("support_feedback")
      .insert({
        workspace_id: tokenRow.workspace_id,
        thread_id: tokenRow.thread_id,
        score: Number(score),
        reason_category: null,
      });
    if (insertError && insertError.code !== "23505") throw new Error(insertError.message);
  }

  if (!tokenRow.consumed_at) {
    const { error: consumeError } = await serviceClient
      .from("csat_survey_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .is("consumed_at", null);
    if (consumeError) throw new Error(consumeError.message);
  }

  const messages = await loadThankYouMessages(serviceClient, tokenRow.workspace_id);
  const { data: workspace, error: workspaceError } = await serviceClient
    .from("workspaces")
    .select("name")
    .eq("id", tokenRow.workspace_id)
    .maybeSingle();
  if (workspaceError) throw new Error(workspaceError.message);
  return {
    ok: true,
    workspaceName: workspace?.name || "Sona",
    score: Number(existing?.score || score),
    group: selectThankYouMessage(messages, Number(existing?.score || score)),
  };
}

export async function sendPublishedCsatSurveyEmail(
  serviceClient,
  {
    workspaceId,
    threadId,
    recipient,
    data,
    mailbox = null,
    expiresAt = null,
  } = {}
) {
  const published = await loadPublishedCsatTemplate(serviceClient, workspaceId);
  if (!published) throw new Error("No published CSAT email template exists for this workspace.");
  const tokenRow = await issueCsatSurveyToken(serviceClient, {
    workspaceId,
    threadId,
    expiresAt,
  });
  const rendered = await renderCsatEmail({
    content: published.editor_json,
    subject: published.subject,
    data,
    linkMode: "live",
    token: tokenRow.token,
  });
  const fromEmail = String(buildEffectiveSharedFromEmail({ mailbox }) || FALLBACK_FROM_EMAIL).trim();
  const fromName = String(mailbox?.from_name || FALLBACK_FROM_NAME).trim();
  const sendResult = await sendPostmarkEmail({
    From: `${fromName} <${fromEmail}>`,
    To: recipient,
    Subject: rendered.subject,
    TextBody: rendered.text,
    HtmlBody: rendered.html,
    ReplyTo: String(mailbox?.from_email || mailbox?.provider_email || fromEmail).trim(),
    Tag: "csat-survey",
    Metadata: {
      sona_workspace_id: workspaceId,
      sona_thread_id: threadId,
      sona_csat_version: String(published.version),
    },
  });
  return { ...sendResult, token: tokenRow.token, version: published.version };
}
