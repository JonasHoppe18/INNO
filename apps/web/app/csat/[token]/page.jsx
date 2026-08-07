"use client";

/* eslint-disable @next/next/no-img-element -- customer logos are workspace-managed URLs. */

import { useEffect, useMemo, useState } from "react";

function safeAccent(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#635bff";
}

export default function CustomerSatisfactionSurveyPage({ params }) {
  const [settings, setSettings] = useState(null);
  const [state, setState] = useState("loading");
  const [selected, setSelected] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const accent = useMemo(() => safeAccent(settings?.accent), [settings?.accent]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const linkedScore = Number(query.get("score"));
    const language = query.get("language");
    const languageQuery = language ? `?language=${encodeURIComponent(language)}` : "";
    fetch(`/api/csat/survey/${encodeURIComponent(params?.token || "")}${languageQuery}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "This survey link is unavailable.");
        if (!active) return;
        setSettings(payload.settings || {});
        if (Number.isInteger(linkedScore) && linkedScore >= 1 && linkedScore <= 5) setSelected(linkedScore);
        setState(payload.status === "responded" ? "thanks" : "ready");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError.message || "This survey link is unavailable.");
        setState("error");
      });
    return () => { active = false; };
  }, [params?.token]);

  const submit = async () => {
    if (state !== "ready" || !selected || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/csat/survey/${encodeURIComponent(params?.token || "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score: selected }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save your feedback.");
      setState("thanks");
    } catch (submitError) {
      setError(submitError.message || "Could not save your feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f7fa] px-4 py-10 text-[#111118] sm:py-16">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-xl items-center justify-center">
        <section className="w-full rounded-2xl border border-[#e6e6ec] bg-white p-7 text-center shadow-[0_16px_48px_rgba(20,20,30,0.07)] sm:p-12">
          {state === "loading" ? (
            <div className="space-y-4" aria-busy="true"><div className="mx-auto h-8 w-40 animate-pulse rounded-lg bg-[#eeeeF4]" /><div className="mx-auto h-5 w-72 max-w-full animate-pulse rounded bg-[#f2f2f6]" /><div className="mx-auto mt-8 h-12 w-72 max-w-full animate-pulse rounded-full bg-[#f2f2f6]" /></div>
          ) : state === "error" ? (
            <div role="alert"><h1 className="text-2xl font-semibold tracking-tight">Survey unavailable</h1><p className="mt-3 text-sm leading-6 text-[#6b6b78]">{error}</p></div>
          ) : state === "thanks" ? (
            <div><div className="mx-auto flex size-12 items-center justify-center rounded-full text-xl font-semibold text-white" style={{ backgroundColor: accent }}>✓</div><p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b78]">{settings?.company || "Customer feedback"}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{settings?.thankYouTitle || "Thank you"}</h1><p className="mx-auto mt-4 max-w-sm text-base leading-7 text-[#6b6b78]">{settings?.thankYou || "Thanks for helping us improve."}</p></div>
          ) : (
            <div>
              {settings?.logoUrl ? <img src={settings.logoUrl} alt={`${settings.company || "Company"} logo`} className="mx-auto mb-6 max-h-12 max-w-40 object-contain" /> : null}
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b78]">{settings?.company || "Customer feedback"}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{settings?.headline || "How was your support experience?"}</h1>
              <p className="mx-auto mt-4 max-w-md text-base leading-7 text-[#6b6b78]">{settings?.intro || "We'd love to hear how we did."}</p>
              <div className="mt-9 flex justify-center gap-2" role="group" aria-label="Rate your support experience">
                {[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" onClick={() => setSelected(score)} disabled={submitting} aria-label={`${score} out of 5`} aria-pressed={selected === score} className="flex size-12 items-center justify-center rounded-full border border-[#d8d8e0] bg-white text-sm font-semibold text-[#5d5d69] transition-[transform,background-color,color,border-color] duration-150 hover:border-[#b5b5c0] hover:text-[#111118] active:scale-[0.97] disabled:cursor-wait" style={selected === score ? { borderColor: accent, backgroundColor: accent, color: "white" } : undefined}>{score}</button>)}
              </div>
              <div className="mx-auto mt-3 flex max-w-[260px] justify-between px-1 text-xs text-[#8b8b96]"><span>{settings?.lowLabel || "Very poor"}</span><span>{settings?.highLabel || "Excellent"}</span></div>
              <p className="mt-6 text-xs leading-5 text-[#8b8b96]">{settings?.instruction || "Click a number to share your feedback. No sign-in required."}</p>
              {error ? <p role="alert" className="mt-5 text-sm text-red-600">{error}</p> : null}
              <button type="button" onClick={submit} disabled={!selected || submitting} className="mt-7 inline-flex h-11 min-w-36 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: accent }}>{submitting ? (settings?.sendingLabel || "Sending…") : (settings?.submitLabel || "Submit feedback")}</button>
              <p className="mt-9 text-xs leading-5 text-[#8b8b96]">{settings?.footer || "Your feedback helps us make every reply better."}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
