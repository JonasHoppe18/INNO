// The page customers see after they rate. Used by the live response page and the Settings preview.
export function CsatThankYouCard({ workspaceName, heading, body, buttonText, buttonUrl }) {
  return (
    <section className="w-full max-w-xl rounded-[28px] border border-[#e7e7ef] bg-white p-7 text-center shadow-[0_18px_50px_rgba(20,20,30,0.08)] sm:p-12">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-xl text-violet-600">✓</div>
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{workspaceName || "Sona"}</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{heading}</h1>
      <p className="mx-auto mt-4 max-w-md whitespace-pre-line text-sm leading-6 text-slate-600">{body}</p>
      {buttonText && buttonUrl ? (
        <a href={buttonUrl} className="mt-7 inline-flex items-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">
          {buttonText}
        </a>
      ) : null}
    </section>
  );
}
