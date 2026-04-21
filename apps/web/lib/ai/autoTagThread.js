const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const SYSTEM_PROMPT = `Du er en support-kategoriseringsmodel. Du modtager en support-samtale og en liste af tilgængelige tags.
Returner JSON med præcis disse felter:
- tag_ids: array af op til 3 tag-IDs der passer bedst til sagen (kan være tomt array [])
- solution_summary: 1-2 sætninger der beskriver hvad kundens problem var og hvordan det blev løst

Regler:
- Vælg KUN tag-IDs fra listen over tilgængelige tags
- Returner aldrig tag-IDs der ikke er i listen
- Returner altid valid JSON — ingen markdown, ingen forklaring
- Vær kortfattet i solution_summary`;

/**
 * Kalder OpenAI for at klassificere en ticket og generere en løsningsopsummering.
 * @param {{ subject: string, sentReply: string, availableTags: Array<{id: string, name: string, category?: string}> }} options
 * @returns {Promise<{ tag_ids: string[], solution_summary: string }>}
 */
export async function autoTagThread({ subject, sentReply, availableTags }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY mangler.");
  if (!availableTags?.length) return { tag_ids: [], solution_summary: "" };

  const tagList = availableTags
    .map((t) => `- ID: ${t.id} | Navn: ${t.name}${t.category ? ` | Kategori: ${t.category}` : ""}`)
    .join("\n");

  const userMessage = [
    `Emne: ${subject || "(intet emne)"}`,
    "",
    `Svar sendt til kunden:`,
    sentReply?.trim() || "(intet svar)",
    "",
    "Tilgængelige tags:",
    tagList,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenAI fejl ${response.status}: ${err}`);
  }

  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tag_ids: [], solution_summary: "" };
  }

  const validIds = new Set(availableTags.map((t) => t.id));
  const tag_ids = (Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [])
    .filter((id) => typeof id === "string" && validIds.has(id))
    .slice(0, 3);

  const solution_summary = typeof parsed.solution_summary === "string"
    ? parsed.solution_summary.trim().slice(0, 500)
    : "";

  return { tag_ids, solution_summary };
}
