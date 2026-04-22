import { createClient } from "jsr:@supabase/supabase-js@2";

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

async function callOpenAI(apiKey: string, messages: object[], responseFormat = true): Promise<string> {
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
      ...(responseFormat ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export async function autoTagThread(params: AutoTagParams): Promise<void> {
  const { supabase, workspaceId, threadId, subject, body, openaiApiKey } = params;

  // Skip if thread already has AI tags (inbound already tagged it, avoid double-tagging)
  const { count: existing } = await supabase
    .from("thread_tag_assignments")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("source", "ai");
  if ((existing ?? 0) > 0) return;

  const { data: workspaceTags } = await supabase
    .from("workspace_tags")
    .select("id, name, ai_prompt")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  const ticketContent = `Subject: ${subject || "(none)"}\n\n${(body || "").slice(0, 1500)}`;

  // No workspace tags — generate one English tag and save it for future reuse
  if (!workspaceTags?.length) {
    const raw = await callOpenAI(openaiApiKey, [
      {
        role: "system",
        content:
          "You are a support ticket classifier. Given a support ticket, return a single short English tag that best describes the topic (e.g. 'shipping', 'return', 'billing', 'product-question', 'account-issue'). Return JSON: { \"tag_name\": \"<name>\" }",
      },
      { role: "user", content: ticketContent },
    ]);

    let tagName: string | null = null;
    try {
      const parsed = JSON.parse(raw);
      tagName = typeof parsed.tag_name === "string" ? parsed.tag_name.trim().slice(0, 50) : null;
    } catch { /* ignore */ }
    if (!tagName) return;

    // Insert or reuse existing tag with this name
    const { data: inserted } = await supabase
      .from("workspace_tags")
      .upsert(
        { workspace_id: workspaceId, name: tagName, color: "#64748b", category: "ai_generated", is_active: true },
        { onConflict: "workspace_id,name", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();

    // If upsert didn't return (existing row), fetch it
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
      await supabase
        .from("thread_tag_assignments")
        .upsert({ thread_id: threadId, tag_id: tagId, source: "ai" }, { onConflict: "thread_id,tag_id", ignoreDuplicates: true });
    }
    return;
  }

  // Workspace has tags — evaluate with per-tag prompts where available
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
      .filter((id): id is string => typeof id === "string" && validIds.has(id))
      .slice(0, 2);
  } catch { /* ignore */ }

  if (tagIds.length) {
    await supabase
      .from("thread_tag_assignments")
      .upsert(
        tagIds.map((id) => ({ thread_id: threadId, tag_id: id, source: "ai" })),
        { onConflict: "thread_id,tag_id", ignoreDuplicates: true },
      );
  }
}
