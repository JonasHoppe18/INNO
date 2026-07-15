import { getTranslations } from "next-intl/server";
import { CheckIcon } from "./icons";

// Visuals er stiliserede produkt-udsnit (statisk markup — bevidst simple;
// DemoInbox i hero bærer den fulde produkt-gengivelse).
function KnowledgeVisual() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm">
      <p className="text-[10px] font-bold tracking-wider text-zinc-400">SONA'S SOURCES</p>
      {["Return policy · §4", "Shipping times · EU", "Past ticket · T-38102"].map((s) => (
        <p key={s} className="mt-2 rounded-md bg-indigo-50/60 px-3 py-2 text-xs font-medium text-indigo-700">{s}</p>
      ))}
    </div>
  );
}

function ActionsVisual() {
  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-4 text-left shadow-sm">
      <p className="text-xs font-bold text-zinc-900">Refund suggested</p>
      <p className="mt-0.5 text-xs text-zinc-500">Ceramic vase · €89.00 · damage documented</p>
      <div className="mt-3 flex gap-2">
        <span className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Approve refund (€89.00)</span>
        <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600">Decline</span>
      </div>
    </div>
  );
}

function AutopilotVisual() {
  const rows = [
    ["Tracking questions", true],
    ["Order status", true],
    ["Refund requests", false],
  ];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm">
      {rows.map(([label, on]) => (
        <div key={label} className="flex items-center justify-between border-b border-zinc-50 py-2 last:border-0">
          <span className="text-xs font-medium text-zinc-800">{label}</span>
          <span className={`relative inline-block h-4 w-8 rounded-full ${on ? "bg-indigo-600" : "bg-zinc-200"}`}>
            <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white ${on ? "right-0.5" : "left-0.5"}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function FeatureDives() {
  const t = await getTranslations("landing.dives");
  const dives = [
    { key: "a", visual: <KnowledgeVisual /> },
    { key: "b", visual: <ActionsVisual /> },
    { key: "c", visual: <AutopilotVisual /> },
  ];
  return (
    <section className="px-5 py-20">
      <div className="mx-auto flex max-w-5xl flex-col gap-16">
        {dives.map(({ key, visual }, i) => (
          <div key={key} className={`flex flex-col items-center gap-8 md:flex-row ${i % 2 ? "md:flex-row-reverse" : ""}`}>
            <div className="flex-1">
              <p className="text-xs font-bold tracking-[0.1em] text-indigo-600">{t(`${key}Kicker`)}</p>
              <h3 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">{t(`${key}Title`)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{t(`${key}Body`)}</p>
              <ul className="mt-4 space-y-2">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="flex items-center gap-2 text-sm text-zinc-700">
                    <CheckIcon /> {t(`${key}Point${n}`)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="w-full max-w-sm flex-1">{visual}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
