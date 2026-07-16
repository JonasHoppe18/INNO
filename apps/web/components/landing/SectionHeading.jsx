import Reveal from "./Reveal";

// Shared section heading: kicker + title (+ optional subtitle). Keeps every
// section on the same typographic rhythm instead of each re-declaring its own
// slightly-different markup. Defaults to centered; pass align="left" for the
// split (text-beside-visual) sections.
export default function SectionHeading({ kicker, title, subtitle, align = "center" }) {
  const alignClass = align === "left" ? "text-left" : "mx-auto max-w-2xl text-center";
  return (
    <Reveal className={alignClass}>
      {kicker ? (
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">{kicker}</p>
      ) : null}
      <h2 className="mt-2.5 text-balance text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-3.5 text-base leading-relaxed text-zinc-600">{subtitle}</p>
      ) : null}
    </Reveal>
  );
}
