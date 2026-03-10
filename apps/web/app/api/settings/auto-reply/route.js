import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL =
  (process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const DEFAULT_SUBJECT = "Tak for din henvendelse";
const DEFAULT_TEXT =
  "Hej,\n\nTak for din henvendelse. Vi har modtaget din besked og vender tilbage hurtigst muligt.\n\nMed venlig hilsen\nSona Team";
const DEFAULT_TEMPLATE_HTML =
  "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#111\">{{content}}</div>";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value, fallback = "") {
  const next = typeof value === "string" ? value.trim() : "";
  return next || fallback;
}

function asBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asCooldownMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1440;
  return Math.max(1, Math.min(7 * 24 * 60, Math.round(parsed)));
}

async function loadSettings(serviceClient, scope) {
  const query = serviceClient
    .from("mail_auto_reply_settings")
    .select(
      "id, workspace_id, mailbox_id, enabled, trigger_mode, cooldown_minutes, subject_template, body_text_template, body_html_template, template_id, updated_at"
    )
    .eq("workspace_id", scope.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(10);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => !row.mailbox_id) || rows[0] || null;
}

async function loadTemplate(serviceClient, scope, templateId) {
  if (!templateId) return null;
  const query = serviceClient
    .from("mail_auto_reply_templates")
    .select("id, name, html_layout, plain_text_fallback, updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", templateId)
    .maybeSingle();
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || null;
}

export async function GET() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }

    const setting = await loadSettings(serviceClient, scope);
    const template = await loadTemplate(serviceClient, scope, setting?.template_id || null);
    return NextResponse.json(
      {
        setting: setting
          ? {
              ...setting,
              subject_template: setting.subject_template || DEFAULT_SUBJECT,
              body_text_template: setting.body_text_template || DEFAULT_TEXT,
              body_html_template: setting.body_html_template || "",
            }
          : {
              id: null,
              enabled: false,
              trigger_mode: "first_inbound_per_thread",
              cooldown_minutes: 1440,
              subject_template: DEFAULT_SUBJECT,
              body_text_template: DEFAULT_TEXT,
              body_html_template: "",
              template_id: null,
            },
        template: template || {
          id: null,
          name: "Default template",
          html_layout: DEFAULT_TEMPLATE_HTML,
          plain_text_fallback: "",
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Supabase service configuration is missing." }, { status: 500 });
  }

  let body = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope.workspaceId) {
      return NextResponse.json({ error: "Workspace scope not found." }, { status: 404 });
    }

    const existing = await loadSettings(serviceClient, scope);
    const templateName = asString(body?.template_name, "Auto reply template");
    const templateHtml = asString(body?.template_html, DEFAULT_TEMPLATE_HTML);
    const templateTextFallback = asString(body?.template_text_fallback, "");
    const nowIso = new Date().toISOString();

    let templateId = asString(body?.template_id || existing?.template_id || "");
    if (templateId) {
      const templateUpdateQuery = serviceClient
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
      const { data: updatedTemplate, error: updateTemplateError } = await templateUpdateQuery;
      if (updateTemplateError || !updatedTemplate?.id) {
        return NextResponse.json(
          { error: updateTemplateError?.message || "Could not update template." },
          { status: 500 }
        );
      }
    } else {
      const { data: insertedTemplate, error: insertTemplateError } = await serviceClient
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
      if (insertTemplateError || !insertedTemplate?.id) {
        return NextResponse.json(
          { error: insertTemplateError?.message || "Could not create template." },
          { status: 500 }
        );
      }
      templateId = insertedTemplate.id;
    }

    const payload = {
      enabled: asBool(body?.enabled, false),
      trigger_mode: asString(body?.trigger_mode, "first_inbound_per_thread"),
      cooldown_minutes: asCooldownMinutes(body?.cooldown_minutes),
      subject_template: asString(body?.subject_template, DEFAULT_SUBJECT),
      body_text_template: asString(body?.body_text_template, DEFAULT_TEXT),
      body_html_template: asString(body?.body_html_template, ""),
      template_id: templateId || null,
      updated_at: nowIso,
    };

    if (existing?.id) {
      const updateQuery = serviceClient
        .from("mail_auto_reply_settings")
        .update({
          ...payload,
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("id", existing.id)
        .select("id")
        .maybeSingle();
      const { data: updated, error: updateError } = await updateQuery;
      if (updateError || !updated?.id) {
        return NextResponse.json({ error: updateError?.message || "Could not save settings." }, { status: 500 });
      }
    } else {
      const { data: inserted, error: insertError } = await serviceClient
        .from("mail_auto_reply_settings")
        .insert({
          workspace_id: scope.workspaceId,
          mailbox_id: null,
          ...payload,
          created_at: nowIso,
        })
        .select("id")
        .maybeSingle();
      if (insertError || !inserted?.id) {
        return NextResponse.json({ error: insertError?.message || "Could not save settings." }, { status: 500 });
      }
    }

    const setting = await loadSettings(serviceClient, scope);
    const template = await loadTemplate(serviceClient, scope, templateId);
    return NextResponse.json({ setting, template }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
