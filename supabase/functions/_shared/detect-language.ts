const SUPPORTED = new Set(["en", "da", "de", "es", "fr", "sv", "no"]);

/**
 * Calls GPT-4o-mini to detect the ISO-639-1 language code of the given text.
 * Returns a supported code (en/da/de/es/fr/sv/no) or "unknown".
 * Skips the call and returns "unknown" if text is shorter than 10 chars.
 */
export async function detectCustomerLanguage(
  text: string,
  openaiApiKey: string,
): Promise<string> {
  const cleaned = String(text || "").trim();
  if (!cleaned || cleaned.length < 10 || !openaiApiKey) return "unknown";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 5,
        messages: [
          {
            role: "system",
            content:
              "Respond ONLY with the ISO-639-1 language code (e.g. 'da', 'en', 'de'). No other text.",
          },
          {
            role: "user",
            content: `Detect language: ${cleaned.slice(0, 400)}`,
          },
        ],
      }),
    });
    if (!res.ok) return "unknown";
    const json = await res.json().catch(() => null);
    const code = String(json?.choices?.[0]?.message?.content || "")
      .trim()
      .toLowerCase()
      .slice(0, 2);
    return SUPPORTED.has(code) ? code : "unknown";
  } catch {
    return "unknown";
  }
}
