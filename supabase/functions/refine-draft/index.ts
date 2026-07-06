// supabase/functions/refine-draft/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  fetchPolicies,
  fetchRelevantKnowledge,
} from "../_shared/agent-context.ts";
import { buildPinnedPolicyContext } from "../_shared/policy-context.ts";
import {
  buildSupportVoiceRewriteInstruction,
  detectSupportVoiceViolations,
  sanitizeSupportVoiceDraft,
} from "../_shared/support-voice.ts";

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
  // Optional: snippet IDs the agent picked via the "/" slash-command. Their
  // content is force-injected as REQUIRED REFERENCES so the AI must use them
  // when rewriting (overrides the semantic-retrieval pick).
  const forcedSnippetIds = Array.isArray(body?.snippetIds)
    ? (body.snippetIds as unknown[]).map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (!shopId || !currentDraft || !userPrompt) {
    return new Response(
      JSON.stringify({ error: "shopId, currentDraft and userPrompt are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // If the agent explicitly picked snippets via slash-command, fetch their
  // content directly — they must end up in the prompt regardless of what
  // semantic retrieval surfaces. Fetched in parallel with the other context.
  const fetchForcedSnippets = async () => {
    if (!forcedSnippetIds.length) return [];
    const { data, error } = await supabase
      .from("agent_knowledge")
      .select("content, metadata, chunk_index")
      .eq("shop_id", shopId)
      .eq("source_provider", "manual_text")
      .in("metadata->>snippet_id", forcedSnippetIds);
    if (error) {
      console.warn("[refine-draft] forced snippets fetch failed:", error.message);
      return [];
    }
    // Re-assemble multi-chunk snippets in chunk order so the AI sees full text.
    const bySnippet = new Map<string, { title: string; chunks: Array<{ idx: number; content: string }> }>();
    for (const row of data || []) {
      const meta = (row as any).metadata || {};
      const sid = String(meta.snippet_id || "").trim();
      if (!sid) continue;
      if (!bySnippet.has(sid)) {
        bySnippet.set(sid, {
          title: String(meta.title || "Untitled").trim(),
          chunks: [],
        });
      }
      bySnippet.get(sid)!.chunks.push({
        idx: Number(meta.chunk_index ?? (row as any).chunk_index ?? 0),
        content: String((row as any).content || ""),
      });
    }
    return Array.from(bySnippet.values()).map((s) => ({
      title: s.title,
      content: s.chunks
        .sort((a, b) => a.idx - b.idx)
        .map((c) => c.content)
        .join("\n\n"),
    }));
  };

  const [policies, knowledgeMatches, forcedSnippets] = await Promise.all([
    fetchPolicies(supabase, userId, workspaceId),
    fetchRelevantKnowledge(supabase, shopId, userPrompt, 4),
    fetchForcedSnippets(),
  ]);

  const policyContext = buildPinnedPolicyContext({
    subject: threadSubject,
    body: userPrompt,
    policies,
  });

  const knowledgeBlock = knowledgeMatches.length > 0
    ? `RELEVANT KNOWLEDGE:\n${knowledgeMatches.map((k) => k.content).join("\n\n")}`
    : "";

  // Forced references trump regular retrieval — the agent explicitly picked
  // these snippets and the AI MUST incorporate them into the rewrite.
  const forcedBlock = forcedSnippets.length > 0
    ? `REQUIRED REFERENCES (the agent explicitly picked these snippets — you MUST use their content in the rewritten draft):\n\n${forcedSnippets
        .map((s) => `### ${s.title}\n${s.content}`)
        .join("\n\n---\n\n")}`
    : "";

  const systemPrompt = [
    "You are a support reply editor. The agent has reviewed a draft reply and wants you to rewrite it according to their specific instruction.",
    "",
    "CRITICAL RULES — read carefully:",
    "1. Apply the agent's instruction LITERALLY and EXACTLY. The instruction is the source of truth, not the current draft.",
    "2. If the agent says 'include X' or 'add Y', you MUST add concrete content about X/Y to the draft — write the actual steps, info, or procedures. Do NOT just say the draft already includes it.",
    "3. If the instruction asks for troubleshooting guides (firmware update, factory reset, re-pairing, etc.), write out the actual steps in the reply — use RELEVANT KNOWLEDGE below if available, otherwise use standard support steps for the device type.",
    "4. If the instruction asks to change tone, length, or style, rewrite the draft fully in that new style.",
    "5. Preserve the original draft's structure (greeting and body) unless the instruction says otherwise.",
    "6. Preserve the language of the existing draft unless the instruction explicitly says to change it.",
    "7. Do NOT add, preserve, or invent an agent signature, sender name, team name, footer, or closing block such as 'Best regards'. The application adds the user's configured signature after refinement.",
    "8. Return ONLY the refined draft text — no explanation, no preamble, no surrounding quotes, no meta-commentary about what you changed.",
    "",
    "SUPPORT VOICE — always apply:",
    "- Write like an experienced customer support employee, not an AI model or internal workflow system.",
    "- Preserve facts and safety limits, but express them as customer-facing outcomes and next steps.",
    "- Do not expose internal process wording, internal data/system wording, team handoff language, manual-review wording, AI/meta wording, or generic filler.",
    "- Forbidden customer-facing patterns include: 'teamet kan', 'our team can', 'vores system', 'in our system', 'manuel gennemgang', 'manual review', 'undersøge yderligere', 'investigate further', 'feel free to reach out', and 'tak for din henvendelse'.",
    "",
    "If the instruction would conflict with shop policy below, follow the policy and ignore that part of the instruction (but still apply the rest).",
    policyContext.policyRulesText,
    policyContext.policySummaryText,
    policyContext.policyExcerptText,
    forcedBlock,
    knowledgeBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userMessage = `CURRENT DRAFT:\n${currentDraft}\n\nAGENT INSTRUCTION (apply this — rewrite the draft to satisfy it):\n${userPrompt}`;

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      // Upgraded from gpt-4o-mini → gpt-4o. The mini model often ignored
      // instructions like "include firmware update steps" and returned the
      // draft essentially unchanged. The full model follows complex rewrite
      // instructions much more reliably.
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 1600,
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
  let refinedDraft = sanitizeSupportVoiceDraft(String(
    (openaiData as any)?.choices?.[0]?.message?.content || ""
  ).trim());

  const supportVoiceViolations = detectSupportVoiceViolations(refinedDraft);
  if (supportVoiceViolations.length > 0) {
    const supportVoiceRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.2,
        max_tokens: 1600,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              "CURRENT REFINED DRAFT:",
              refinedDraft,
              "",
              "REWRITE INSTRUCTION:",
              buildSupportVoiceRewriteInstruction({
                language: "the same language as the current draft",
                violations: supportVoiceViolations,
              }),
            ].join("\n"),
          },
        ],
      }),
    });

    if (supportVoiceRes.ok) {
      const supportVoiceData = await supportVoiceRes.json().catch(() => ({}));
      const supportVoiceDraft = sanitizeSupportVoiceDraft(String(
        (supportVoiceData as any)?.choices?.[0]?.message?.content || "",
      ).trim());
      if (supportVoiceDraft) refinedDraft = supportVoiceDraft;
    } else {
      console.warn(
        "[refine-draft] support voice rewrite failed:",
        supportVoiceRes.status,
      );
    }
  }

  return new Response(JSON.stringify({ draft: refinedDraft }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
