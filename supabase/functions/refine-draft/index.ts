// supabase/functions/refine-draft/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  fetchPolicies,
  fetchRelevantKnowledge,
} from "../_shared/agent-context.ts";
import { buildPinnedPolicyContext } from "../_shared/policy-context.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => null);
  const shopId = String(body?.shopId || "").trim();
  const workspaceId = String(body?.workspaceId || "").trim() || null;
  const userId = String(body?.userId || "").trim() || null;
  const threadSubject = String(body?.threadSubject || "").trim();
  const currentDraft = String(body?.currentDraft || "").trim();
  const userPrompt = String(body?.userPrompt || "").trim();

  if (!shopId || !currentDraft || !userPrompt) {
    return new Response(
      JSON.stringify({ error: "shopId, currentDraft and userPrompt are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const [policies, knowledgeMatches] = await Promise.all([
    fetchPolicies(supabase, userId, workspaceId),
    fetchRelevantKnowledge(supabase, shopId, userPrompt, 4),
  ]);

  const policyContext = buildPinnedPolicyContext({
    subject: threadSubject,
    body: userPrompt,
    policies,
  });

  const knowledgeBlock = knowledgeMatches.length > 0
    ? `RELEVANT KNOWLEDGE:\n${knowledgeMatches.map((k) => k.content).join("\n\n")}`
    : "";

  const systemPrompt = [
    "You are a support reply editor. Refine the existing draft based on the agent's instruction.",
    "Return ONLY the refined draft text — no explanation, no preamble, no surrounding quotes.",
    "Preserve the language of the existing draft unless the instruction explicitly says to change it.",
    policyContext.policyRulesText,
    policyContext.policySummaryText,
    policyContext.policyExcerptText,
    knowledgeBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userMessage = `CURRENT DRAFT:\n${currentDraft}\n\nINSTRUCTION: ${userPrompt}`;

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!openaiRes.ok) {
    const err = await openaiRes.json().catch(() => ({}));
    return new Response(
      JSON.stringify({ error: (err as any)?.error?.message || "OpenAI error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const openaiData = await openaiRes.json();
  const refinedDraft = String(
    (openaiData as any)?.choices?.[0]?.message?.content || ""
  ).trim();

  return new Response(JSON.stringify({ draft: refinedDraft }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
