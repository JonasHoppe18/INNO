import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { SUPPORT_LANGUAGE_LABELS } from "@/lib/translation/languages";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = "gpt-4o-mini";

export async function POST(request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = String(body?.text || "").trim();
  const targetLanguage = String(body?.targetLanguage || "").trim();

  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });
  if (!targetLanguage) return NextResponse.json({ error: "Missing targetLanguage" }, { status: 400 });

  const languageLabel = SUPPORT_LANGUAGE_LABELS[targetLanguage] || targetLanguage;

  if (!OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured" }, { status: 500 });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate the following support email draft to ${languageLabel}. Preserve the tone, formatting, and any names/order numbers exactly. Return only the translated text with no explanations.`,
          },
          { role: "user", content: text },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Translation failed" }, { status: 502 });
    }

    const data = await response.json();
    const translatedText = data?.choices?.[0]?.message?.content?.trim() || "";

    return NextResponse.json({ translatedText });
  } catch {
    return NextResponse.json({ error: "Translation failed" }, { status: 500 });
  }
}
