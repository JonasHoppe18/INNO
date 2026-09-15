"use client";

import { useState } from "react";

const SCORES = [1, 2, 3, 4, 5];

function responseCopy(reason) {
  if (reason === "invalid_score") return "That rating is not valid.";
  if (reason === "expired_token") return "This feedback link has expired.";
  if (reason === "missing_token") return "This feedback link is incomplete.";
  return "This feedback link is no longer available.";
}

export default function CsatResponseClient({ token, initialScore }) {
  const [score, setScore] = useState(SCORES.includes(Number(initialScore)) ? Number(initialScore) : null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!score || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/csat/respond/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "invalid_token");
      setResult(payload);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8f8fb] px-4 py-10 sm:px-6 sm:py-16">
        <section className="w-full max-w-xl rounded-[28px] border border-[#e7e7ef] bg-white p-7 text-center shadow-[0_18px_50px_rgba(20,20,30,0.08)] sm:p-12">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-xl text-violet-600">✓</div>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{result.workspaceName || "Sona"}</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{result.group?.heading}</h1>
          <p className="mx-auto mt-4 max-w-md whitespace-pre-line text-sm leading-6 text-slate-600">{result.group?.body}</p>
          {result.group?.button_text && result.group?.button_url ? (
            <a href={result.group.button_url} className="mt-7 inline-flex items-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">
              {result.group.button_text}
            </a>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f8fb] px-4 py-10 sm:px-6 sm:py-16">
      <section className="w-full max-w-xl rounded-[28px] border border-[#e7e7ef] bg-white p-7 text-center shadow-[0_18px_50px_rgba(20,20,30,0.08)] sm:p-12">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-600">✦</div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Sona</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">How was your support experience?</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-slate-600">We’d love to hear how we did. Choose a rating to share your experience.</p>
        <div className="mx-auto mt-8 grid max-w-[360px] grid-cols-5 gap-2 sm:gap-3" role="radiogroup" aria-label="Support experience rating">
          {SCORES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={score === value}
              onClick={() => setScore(value)}
              className={`aspect-square rounded-full border text-base font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${score === value ? "border-violet-600 bg-violet-600 text-white shadow-lg shadow-violet-600/20" : "border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700"}`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="mx-auto mt-3 flex max-w-[360px] justify-between px-1 text-xs text-slate-400">
          <span>Very poor</span>
          <span>Excellent</span>
        </div>
        {error ? <p className="mt-6 text-sm font-medium text-red-600" role="alert">{responseCopy(error)}</p> : null}
        <button
          type="button"
          onClick={submit}
          disabled={!score || submitting}
          className="mt-8 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {submitting ? "Submitting…" : "Submit rating"}
        </button>
        <p className="mx-auto mt-8 max-w-sm text-xs leading-5 text-slate-400">You’re receiving this because your support conversation was resolved.</p>
      </section>
    </main>
  );
}
