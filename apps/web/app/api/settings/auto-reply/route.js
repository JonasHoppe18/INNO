import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";
import {
  CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT,
  CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT,
  CUSTOMER_CONFIRMATION_DEFAULT_TEXT,
} from "@/lib/server/customer-confirmation";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

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

async function loadConfiguration(serviceClient, workspaceId) {
  const [{ data: settings, error: settingsError }, { data: templates, error: templatesError }, { data: mailboxes, error: mailboxesError }] =
    await Promise.all([
      serviceClient
        .from("mail_auto_reply_settings")
        .select("id, workspace_id, mailbox_id, enabled, include_ticket_number, subject_template, body_text_template, body_html_template, template_id, updated_at")
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
  const templatesById = new Map((templates || []).map((template) => [String(template.id), template]));
  const normalize = (setting, mailboxId = null) => ({
    ...DEFAULT_SETTING,
    ...(setting || {}),
    workspace_id: workspaceId,
    mailbox_id: mailboxId,
    enabled: Boolean(setting?.enabled),
    include_ticket_number: setting?.include_ticket_number !== false,
    subject_template: asString(setting?.subject_template, CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT),
    body_text_template: asString(setting?.body_text_template, CUSTOMER_CONFIRMATION_DEFAULT_TEXT),
    body_html_template: asString(setting?.body_html_template),
  });
  const workspaceSetting = normalize(rows.find((row) => !row.mailbox_id) || null, null);
  const workspaceTemplate = templatesById.get(String(workspaceSetting.template_id || "")) || DEFAULT_TEMPLATE;
  const mailboxPayload = (mailboxes || []).map((mailbox) => {
    const overrideRow = rows.find((row) => String(row.mailbox_id || "") === String(mailbox.id));
    const override = overrideRow ? normalize(overrideRow, mailbox.id) : null;
    const effective = override || { ...workspaceSetting, mailbox_id: mailbox.id };
    const effectiveTemplate =
      templatesById.get(String(effective.template_id || "")) || workspaceTemplate || DEFAULT_TEMPLATE;
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

async function requireContext() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return { response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return { response: NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 }) };
  }
  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
  if (!scope.workspaceId) {
    return { response: NextResponse.json({ error: "Workspace scope not found." }, { status: 404 }) };
  }
  return { serviceClient, scope };
}

async function validateMailbox(serviceClient, workspaceId, mailboxId) {
  if (!mailboxId) return null;
  const { data, error } = await serviceClient
    .from("mail_accounts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", mailboxId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Mailbox not found in this workspace.");
  return data.id;
}

export async function GET() {
  try {
    const context = await requireContext();
    if (context.response) return context.response;
    const payload = await loadConfiguration(context.serviceClient, context.scope.workspaceId);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const context = await requireContext();
    if (context.response) return context.response;
    const { serviceClient, scope } = context;
    const mailboxId = asString(body?.mailbox_id) || null;
    await validateMailbox(serviceClient, scope.workspaceId, mailboxId);

    let existingQuery = serviceClient
      .from("mail_auto_reply_settings")
      .select("id, template_id")
      .eq("workspace_id", scope.workspaceId);
    existingQuery = mailboxId
      ? existingQuery.eq("mailbox_id", mailboxId)
      : existingQuery.is("mailbox_id", null);
    const { data: scopedExisting, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (mailboxId && body?.inherit === true) {
      if (scopedExisting?.id) {
        const { error } = await serviceClient
          .from("mail_auto_reply_settings")
          .delete()
          .eq("workspace_id", scope.workspaceId)
          .eq("id", scopedExisting.id);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json(
        await loadConfiguration(serviceClient, scope.workspaceId),
        { status: 200 },
      );
    }

    const templateName = asString(body?.template_name, "Customer confirmation template");
    const templateHtml = asString(body?.template_html, CUSTOMER_CONFIRMATION_DEFAULT_LAYOUT);
    const templateTextFallback = asString(body?.template_text_fallback);
    const nowIso = new Date().toISOString();
    // A new mailbox override receives its own template. It must never update the
    // workspace template merely because the effective config exposed that id.
    let templateId = asString(
      scopedExisting?.template_id || (!mailboxId ? body?.template_id : ""),
    );

    if (templateId) {
      const { data, error } = await serviceClient
        .from("mail_auto_reply_templates")
        .update({
          name: templateName,
          html_layout: templateHtml,
          plain_text_fallback: templateTextFallback,
          updated_at: nowIso,
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("id", templateId)
        .select("id")
        .maybeSingle();
      if (error || !data?.id) throw new Error(error?.message || "Could not update confirmation template.");
    } else {
      const { data, error } = await serviceClient
        .from("mail_auto_reply_templates")
        .insert({
          workspace_id: scope.workspaceId,
          name: templateName,
          html_layout: templateHtml,
          plain_text_fallback: templateTextFallback,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .maybeSingle();
      if (error || !data?.id) throw new Error(error?.message || "Could not create confirmation template.");
      templateId = data.id;
    }

    const values = {
      workspace_id: scope.workspaceId,
      mailbox_id: mailboxId,
      enabled: asBool(body?.enabled, false),
      include_ticket_number: asBool(body?.include_ticket_number, true),
      trigger_mode: "first_inbound_per_thread",
      cooldown_minutes: 1440,
      subject_template: asString(body?.subject_template, CUSTOMER_CONFIRMATION_DEFAULT_SUBJECT),
      body_text_template: asString(body?.body_text_template, CUSTOMER_CONFIRMATION_DEFAULT_TEXT),
      body_html_template: asString(body?.body_html_template),
      template_id: templateId,
      updated_at: nowIso,
    };

    if (scopedExisting?.id) {
      const { error } = await serviceClient
        .from("mail_auto_reply_settings")
        .update(values)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", scopedExisting.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await serviceClient
        .from("mail_auto_reply_settings")
        .insert({ ...values, created_at: nowIso });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json(
      await loadConfiguration(serviceClient, scope.workspaceId),
      { status: 200 },
    );
  } catch (error) {
    const status = /Mailbox not found/i.test(error.message) ? 400 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}
