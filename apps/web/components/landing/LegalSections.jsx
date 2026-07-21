// Renders a legal document's sections (heading + paragraphs + optional bullet
// list) from data-driven content in messages/*.json (landing.legal.*Sections),
// read via t.raw() in the page. Shared by /privacy and /terms so both stay
// visually consistent.
export default function LegalSections({ sections }) {
  return (
    <div className="mt-10 space-y-9">
      {(sections || []).map((section, i) => (
        <section key={i}>
          <h2 className="text-lg font-bold tracking-tight text-zinc-950">{section.title}</h2>
          <div className="mt-2.5 space-y-3 text-sm leading-relaxed text-zinc-600">
            {(section.paragraphs || []).map((paragraph, j) => (
              <p key={j}>{paragraph}</p>
            ))}
            {section.items?.length ? (
              <ul className="list-disc space-y-1.5 pl-5 marker:text-zinc-300">
                {section.items.map((item, k) => (
                  <li key={k}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}
