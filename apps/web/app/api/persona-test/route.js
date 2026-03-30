import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function POST(request) {
  const { userId } = auth();
  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI API key is not configured." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) ?? {};
  const signature =
    typeof body.signature === "string" && body.signature.trim()
      ? body.signature.trim()
      : "Venlig hilsen\nDin agent";
  const scenario =
    typeof body.scenario === "string" && body.scenario.trim()
      ? body.scenario.trim()
      : "kunden har et generelt spørgsmål";
  const instructions =
    typeof body.instructions === "string" && body.instructions.trim()
      ? body.instructions.trim()
      : "hold tonen venlig og effektiv";

  const systemPrompt =
    "Du er Sona – en hjælpsom kundeservice-agent. " +
    "Hold tonen venlig og effektiv, skriv på dansk og brug kun relevante oplysninger. " +
    "Skriv et kort eksempel på et svar som agenten kan sende til en kunde. " +
    "Eksperimentet er kun en test, så giv ikke endelige løfter og undgå placeholders som {navn} – brug i stedet en generisk hilsen.";

  const userMessage = [
    `Kundesituation: ${scenario}`,
    `Instruktioner: ${instructions}`,
    `Afslut med denne signatur:\n${signature}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.error?.message || "OpenAI request failed.";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return NextResponse.json({ error: "OpenAI returned no response." }, { status: 502 });
  }

  return NextResponse.json({ reply, model: OPENAI_MODEL });
}
