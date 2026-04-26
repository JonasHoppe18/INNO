import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { applyScope, resolveAuthScope } from "@/lib/server/workspace-auth";

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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(_request, { params }) {
  const { userId: clerkUserId, orgId } = await auth();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });

  const threadId = asString(params?.threadId);
  if (!threadId) return NextResponse.json({ error: "threadId is required." }, { status: 400 });

  const serviceClient = createServiceClient();
  if (!serviceClient) return NextResponse.json({ error: "Supabase configuration missing." }, { status: 500 });

  if (!OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI not configured." }, { status: 500 });

  const scope = await resolveAuthScope(serviceClient, { clerkUserId, orgId }).catch(() => null);
  if (!scope?.workspaceId && !scope?.supabaseUserId) {
    return NextResponse.json({ error: "Auth scope not found." }, { status: 401 });
  }

  const { data: thread, error: threadError } = await applyScope(
    serviceClient
      .from("mail_threads")
      .select("id, solution_summary")
      .eq("id", threadId)
      .maybeSingle(),
    scope
  );
  if (threadError || !thread) return NextResponse.json({ error: "Thread not found." }, { status: 404 });

  if (thread.solution_summary) {
    return NextResponse.json({ solution_summary: thread.solution_summary });
  }

  const { data: messages } = await serviceClient
    .from("mail_messages")
    .select("body_text, clean_body_text, from_email, created_at")
    .eq("thread_id", threadId)
    .order("created_at")
    .limit(20);

  const messageContext = (messages ?? [])
    .map((m) => {
      const body = asString(m.clean_body_text || m.body_text).slice(0, 400);
      return `[${m.from_email}]: ${body}`;
    })
    .join("\n\n");

  if (!messageContext) {
    return NextResponse.json({ error: "No messages found to summarize." }, { status: 400 });
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content:
            "You are a support analyst. Given a resolved support conversation, write 1-2 English sentences summarizing how the issue was resolved. Be specific and concise. Focus on what action was taken to solve the problem.",
        },
        { role: "user", content: messageContext },
      ],
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: `OpenAI error ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  const solution_summary = asString(json?.choices?.[0]?.message?.content).slice(0, 500);

  if (!solution_summary) {
    return NextResponse.json({ error: "Could not generate summary." }, { status: 500 });
  }

  await serviceClient
    .from("mail_threads")
    .update({ solution_summary })
    .eq("id", threadId);

  return NextResponse.json({ solution_summary });
}
