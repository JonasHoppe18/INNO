import { getTranslations } from "next-intl/server";
import Reveal from "./Reveal";
import { CheckIcon } from "./icons";

// Supporting visuals — stylised product fragments (the interactive DemoInbox in
// the hero carries the full, real-component rendering). Kept deliberately small
// and calm so they read as illustration, not a second product surface.
function KnowledgeVisual() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-[0_12px_40px_-20px_rgba(0,0,0,0.15)]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sona&apos;s sources</p>
      {["Return policy · §4", "Shipping times · EU", "Past ticket · T-38102"].map((s) => (
        <p key={s} className="mt-2 flex items-center gap-2 rounded-lg bg-indigo-50/70 px-3 py-2 text-xs font-medium text-indigo-700">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {s}
        </p>
      ))}
    </div>
  );
}

function ActionsVisual() {
  return (
    <div className="rounded-2xl border border-indigo-100 bg-white p-5 text-left shadow-[0_12px_40px_-20px_rgba(79,70,229,0.25)]">
      <p className="text-sm font-bold text-zinc-900">Refund suggested</p>
      <p className="mt-0.5 text-xs text-zinc-500">Ceramic vase · €89.00 · damage documented</p>
      <div className="mt-4 flex gap-2">
        <span className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Approve refund (€89.00)</span>
        <span className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600">Decline</span>
      </div>
    </div>
  );
}

export default async function FeatureDives() {
  const t = await getTranslations("landing.dives");
  // "Autopilot" (dive c) intentionally omitted here — the "You're in control"
  // section owns the automation story, so keeping it here duplicated it.
  const dives = [
    { key: "a", visual: <KnowledgeVisual /> },
    { key: "b", visual: <ActionsVisual /> },
  ];
  return (
    <section className="px-5 py-24">
      <div className="mx-auto flex max-w-5xl flex-col gap-20">
        {dives.map(({ key, visual }, i) => (
          <Reveal
            key={key}
            className={`flex flex-col items-center gap-10 md:flex-row ${i % 2 ? "md:flex-row-reverse" : ""}`}
          >
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">{t(`${key}Kicker`)}</p>
              <h3 className="mt-2.5 text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">{t(`${key}Title`)}</h3>
              <p className="mt-3.5 text-base leading-relaxed text-zinc-600">{t(`${key}Body`)}</p>
              <ul className="mt-5 space-y-2.5">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex items-center gap-2 text-sm text-zinc-700">
                    <CheckIcon /> {t(`${key}Point${n}`)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full max-w-sm flex-1">{visual}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
