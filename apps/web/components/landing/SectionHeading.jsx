import Reveal from "./Reveal";

// Shared section heading: kicker + title (+ optional subtitle). Keeps every
// section on the same typographic rhythm instead of each re-declaring its own
// slightly-different markup. Defaults to centered; pass align="left" for the
// split (text-beside-visual) sections. Pass tone="dark" on dark-background
// spotlight bands so the title/subtitle stay legible.
export default function SectionHeading({ kicker, title, subtitle, align = "center", tone = "light" }) {
  const alignClass = align === "left" ? "text-left" : "mx-auto max-w-2xl text-center";
  const dark = tone === "dark";
  return (
    <Reveal className={alignClass}>
      {kicker ? (
        <p className={`text-xs font-bold uppercase tracking-[0.14em] ${dark ? "text-indigo-400" : "text-indigo-600"}`}>
          {kicker}
        </p>
      ) : null}
      <h2
        className={`mt-2.5 text-balance text-3xl font-bold tracking-tight sm:text-4xl ${
          dark ? "text-white" : "text-zinc-950"
        }`}
      >
        {title}
      </h2>
      {subtitle ? (
        <p className={`mt-3.5 text-base leading-relaxed ${dark ? "text-zinc-400" : "text-zinc-600"}`}>
          {subtitle}
        </p>
      ) : null}
    </Reveal>
  );
}
