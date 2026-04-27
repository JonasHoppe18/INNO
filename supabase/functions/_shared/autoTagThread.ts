import { createClient } from "jsr:@supabase/supabase-js@2";
import { seedDefaultWorkspaceTags } from "./seedDefaultWorkspaceTags.ts";

type SupabaseClient = ReturnType<typeof createClient>;

interface AutoTagParams {
  supabase: SupabaseClient;
  workspaceId: string;
  threadId: string;
  subject: string;
  body: string;
  openaiApiKey: string;
}

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

async function callOpenAI(apiKey: string, messages: object[]): Promise<string> {
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

interface WorkspaceTag {
  id: string;
  name: string;
  ai_prompt: string | null;
}

export async function autoTagThread(params: AutoTagParams): Promise<void> {
  const { supabase, workspaceId, threadId, subject, body, openaiApiKey } = params;

  // Skip if thread already has AI tags to avoid double-tagging
  const { count: existing } = await supabase
    .from("thread_tag_assignments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("source", "ai");
  if ((existing ?? 0) > 0) return;

  const queryTags = supabase
    .from("workspace_tags")
    .select("id, name, ai_prompt")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  let result = await queryTags;
  let workspaceTags: WorkspaceTag[] | null = (result.data as WorkspaceTag[]) ?? null;

  // Self-repair: seed default tags if workspace has none, then re-fetch
  if (!workspaceTags?.length) {
    await seedDefaultWorkspaceTags(supabase, workspaceId);
    result = await supabase
      .from("workspace_tags")
      .select("id, name, ai_prompt")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true);
    workspaceTags = (result.data as WorkspaceTag[]) ?? null;
  }

  if (!workspaceTags?.length) return;

  const ticketContent = `Subject: ${subject || "(none)"}\n\n${(body || "").slice(0, 1500)}`;

  const tagList = workspaceTags
    .map((t) => {
      const rule = t.ai_prompt?.trim()
        ? `Apply when: ${t.ai_prompt.trim()}`
        : "(use your judgment based on the tag name)";
      return `- ID: ${t.id} | Name: "${t.name}" | ${rule}`;
    })
    .join("\n");

  const raw = await callOpenAI(openaiApiKey, [
    {
      role: "system",
      content:
        "You are a support ticket classifier. Given a support ticket and a list of tags with application criteria, decide which tags apply. Return JSON: { \"tag_ids\": [\"<id>\", ...] } — max 2 tags, can be empty array []. Only use IDs from the provided list.",
    },
    {
      role: "user",
      content: `${ticketContent}\n\nAvailable tags:\n${tagList}`,
    },
  ]);

  let tagIds: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    const validIds = new Set(workspaceTags.map((t) => t.id));
    tagIds = (Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [])
      .filter((id: unknown): id is string => typeof id === "string" && validIds.has(id))
      .slice(0, 2);
  } catch { /* ignore */ }

  if (tagIds.length) {
    const rows = tagIds.map((id) => ({ thread_id: threadId, tag_id: id, source: "ai" }));
    await (supabase as any)
      .from("thread_tag_assignments")
      .upsert(rows, { onConflict: "thread_id,tag_id", ignoreDuplicates: true });
  }
}
