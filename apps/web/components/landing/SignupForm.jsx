"use client";

import React from "react";
import { useTranslations } from "next-intl";

export default function SignupForm({ source = "landing-hero" }) {
  const t = useTranslations("landing.hero");
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState("idle");
  const [error, setError] = React.useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();
    if (!/\S+@\S+\.\S+/.test(trimmed)) {
      setError(t("emailInvalid"));
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/landing-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source }),
      });
      if (!res.ok) throw new Error();
      setStatus("success");
    } catch {
      setError(t("emailError"));
      setStatus("error");
    }
  };

  if (status === "success") {
    return <p className="text-sm font-medium text-emerald-600">{t("emailSuccess")}</p>;
  }
  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        aria-label={t("emailPlaceholder")}
        className="h-11 flex-1 rounded-lg border border-zinc-200 bg-white px-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="h-11 rounded-lg border border-zinc-200 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
      >
        {t("ctaAccess")}
      </button>
      {error ? <p className="text-sm text-rose-600 sm:col-span-2">{error}</p> : null}
    </form>
  );
}
