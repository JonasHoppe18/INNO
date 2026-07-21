const SECTION_ANCHOR_PREFIX = "knowledge-doc-section-";

// Line-based heading scan. Knowledge documents in this editor are prose,
// lists, and headings — not code documentation — so a "## " line inside a
// code fence is not an expected input and is intentionally not special-cased.
const H2_LINE_PATTERN = /^##(?!#)\s+(.+?)\s*#*\s*$/;

export function sectionAnchorId(index) {
  return `${SECTION_ANCHOR_PREFIX}${index}`;
}

export function parseKnowledgeDocumentOutline(markdown) {
  const lines = String(markdown || "").split("\n");
  const sections = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const match = line.match(H2_LINE_PATTERN);
    if (!match) continue;
    const title = match[1].trim();
    if (!title) continue;
    sections.push({
      id: sectionAnchorId(sections.length),
      index: sections.length,
      title,
    });
  }
  return sections;
}

export function getActiveSectionId({ sectionTops, scrollTop, offset = 0 }) {
  const items = Array.isArray(sectionTops)
    ? sectionTops.filter((item) => item && typeof item.id === "string")
    : [];
  if (!items.length) return null;

  const sorted = [...items].sort((a, b) => Number(a.top) - Number(b.top));
  const threshold = Number(scrollTop || 0) + Number(offset || 0);

  let active = sorted[0].id;
  for (const item of sorted) {
    if (Number(item.top) <= threshold) {
      active = item.id;
    } else {
      break;
    }
  }
  return active;
}
