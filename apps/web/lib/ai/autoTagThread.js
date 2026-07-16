const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

export const AUTO_TAG_SYSTEM_PROMPT = `You classify support conversations using a provided list of tags.
Return JSON with exactly one field:
- tag_ids: an array containing up to 3 matching tag IDs (or an empty array)

Rules:
- Select IDs only from the provided tag list
- Never invent or return an ID that is not in the list
- Return valid JSON only, without markdown or explanation`;

/**
 * Kalder OpenAI for at klassificere en ticket og generere en løsningsopsummering.
 * @param {{ subject: string, sentReply: string, availableTags: Array<{id: string, name: string, category?: string}> }} options
 * @returns {Promise<{ tag_ids: string[] }>}
 */
export async function autoTagThread({ subject, sentReply, availableTags }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY mangler.");
  if (!availableTags?.length) return { tag_ids: [] };

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
        { role: "system", content: AUTO_TAG_SYSTEM_PROMPT },
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
    return { tag_ids: [] };
  }

  const validIds = new Set(availableTags.map((t) => t.id));
  const tag_ids = (Array.isArray(parsed.tag_ids) ? parsed.tag_ids : [])
    .filter((id) => typeof id === "string" && validIds.has(id))
    .slice(0, 3);

  return { tag_ids };
}
