import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { resolveAuthScope } from "@/lib/server/workspace-auth";

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const BATCH_SIZE = 20;
const DELAY_MS = 300; // gentle rate-limiting between batches

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tagThread({ supabase, workspaceId, thread, workspaceTags, openaiApiKey }) {
  const subject = thread.subject || "(none)";
  const body = (thread.clean_body_text || thread.snippet || "").slice(0, 1500);
  const ticketContent = `Subject: ${subject}\n\n${body}`;

  // No workspace tags — generate one English tag and save it for reuse
  if (!workspaceTags.length) {
    let raw = "";
    try {
      const res = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 100,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a support ticket classifier. Given a support ticket, return a single short English tag that best describes the topic (e.g. 'shipping', 'return', 'billing', 'product-question', 'account-issue'). Return JSON: { \"tag_name\": \"<name>\" }",
            },
            { role: "user", content: ticketContent },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        raw = data?.choices?.[0]?.message?.content ?? "";
      }
    } catch { /* ignore */ }

    let tagName = null;
    try { tagName = JSON.parse(raw)?.tag_name?.trim()?.slice(0, 50) || null; } catch { /* ignore */ }
    if (!tagName) return false;

    const { data: inserted } = await supabase
      .from("workspace_tags")
      .upsert(
        { workspace_id: workspaceId, name: tagName, color: "#64748b", category: "ai_generated", is_active: true },
        { onConflict: "workspace_id,name", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();

    let tagId = inserted?.id ?? null;
    if (!tagId) {
      const { data: found } = await supabase
        .from("workspace_tags")
        .select("id")
        .eq("workspace_id", workspaceId)
        .ilike("name", tagName)
        .maybeSingle();
      tagId = found?.id ?? null;
    }

    if (tagId) {
      await supabase.from("thread_tag_assignments").upsert(
        { thread_id: thread.id, tag_id: tagId, source: "ai" },
        { onConflict: "thread_id,tag_id", ignoreDuplicates: true },
      );
      return true;
    }
    return false;
  }

  // Workspace has tags — evaluate using per-tag prompts
  const tagList = workspaceTags
    .map((t) => {
      const rule = t.ai_prompt?.trim() ? `Apply when: ${t.ai_prompt.trim()}` : "(use your judgment based on the tag name)";
      return `- ID: ${t.id} | Name: "${t.name}" | ${rule}`;
    })
    .join("\n");

  let tagIds = [];
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a support ticket classifier. Decide which tags apply to this ticket. Return JSON: { \"tag_ids\": [\"<id>\", ...] } — max 2 tags, can be empty array []. Only use IDs from the provided list.",
          },
          { role: "user", content: `${ticketContent}\n\nAvailable tags:\n${tagList}` },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const raw = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(raw);
      const validIds = new Set(workspaceTags.map((t) => t.id));
      tagIds = (Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [])
        .filter((id) => typeof id === "string" && validIds.has(id))
        .slice(0, 2);
    }
  } catch { /* ignore */ }

  if (tagIds.length) {
    await supabase.from("thread_tag_assignments").upsert(
      tagIds.map((id) => ({ thread_id: thread.id, tag_id: id, source: "ai" })),
      { onConflict: "thread_id,tag_id", ignoreDuplicates: true },
    );
    return true;
  }
  return false;
}

export async function POST() {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Log ind for at fortsætte." }, { status: 401 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase-konfiguration mangler." }, { status: 500 });
  if (!OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY mangler." }, { status: 500 });

  let workspaceId;
  try {
    const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId });
    if (!scope?.workspaceId) return NextResponse.json({ error: "Workspace ikke fundet." }, { status: 404 });
    workspaceId = scope.workspaceId;
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  // Fetch workspace tags once
  const { data: workspaceTags } = await serviceClient
    .from("workspace_tags")
    .select("id, name, ai_prompt")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  // Find threads in this workspace with no AI tag assignments
  const { data: taggedThreadIds } = await serviceClient
    .from("thread_tag_assignments")
    .select("thread_id")
    .eq("source", "ai");

  const taggedSet = new Set((taggedThreadIds || []).map((r) => r.thread_id));

  const { data: allThreads } = await serviceClient
    .from("mail_threads")
    .select("id, subject, snippet")
    .eq("workspace_id", workspaceId)
    .neq("classification_key", "notification")
    .order("created_at", { ascending: false })
    .limit(500);

  const untagged = (allThreads || []).filter((t) => !taggedSet.has(t.id));

  let processed = 0;
  let tagged = 0;

  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    const batch = untagged.slice(i, i + BATCH_SIZE);
    for (const thread of batch) {
      try {
        const didTag = await tagThread({
          supabase: serviceClient,
          workspaceId,
          thread,
          workspaceTags: workspaceTags || [],
          openaiApiKey: OPENAI_API_KEY,
        });
        processed++;
        if (didTag) tagged++;
      } catch { /* skip individual failures */ }
    }
    if (i + BATCH_SIZE < untagged.length) await sleep(DELAY_MS);
  }

  return NextResponse.json({ processed, tagged });
}
