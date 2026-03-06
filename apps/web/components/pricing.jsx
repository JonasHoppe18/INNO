"use client";

import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function Pricing() {
  const [currency, setCurrency] = useState("DKK");

  const plans = [
    {
      name: "Starter",
      tickets: "1,000 tickets",
      priceDkk: 1999,
    },
    {
      name: "Growth",
      tickets: "5,000 tickets",
      priceDkk: 2999,
      featured: true,
    },
    {
      name: "Scale",
      tickets: "10,000 tickets",
      priceDkk: 4999,
    },
  ];

  const currencies = {
    DKK: { code: "DKK", rate: 1, locale: "da-DK", symbol: "kr." },
    EUR: { code: "EUR", rate: 0.134, locale: "de-DE", symbol: "EUR" },
    USD: { code: "USD", rate: 0.145, locale: "en-US", symbol: "USD" },
  };

  const priceFormatter = useMemo(() => {
    const active = currencies[currency];
    return new Intl.NumberFormat(active.locale, {
      style: "currency",
      currency: active.code,
      maximumFractionDigits: 0,
    });
  }, [currency]);

  const formatPrice = (priceDkk) => {
    const active = currencies[currency];
    const converted = Math.round(priceDkk * active.rate);
    return priceFormatter.format(converted);
  };

  return (
    <section id="pricing" className="py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-300/80">Pricing</p>
          <h2 className="text-3xl font-semibold text-white md:text-4xl">Simple pricing by ticket volume</h2>
          <p className="text-sm text-slate-300 md:text-base">All prices are shown excluding VAT.</p>
          <div className="flex items-center justify-center gap-2 pt-2">
            {Object.keys(currencies).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCurrency(option)}
                className={[
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  currency === option
                    ? "border-sky-300/60 bg-sky-400/10 text-white"
                    : "border-white/15 bg-white/5 text-slate-300 hover:border-white/30 hover:text-white",
                ].join(" ")}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={[
                "rounded-2xl border p-6 backdrop-blur",
                plan.featured
                  ? "border-sky-300/60 bg-sky-400/10"
                  : "border-white/10 bg-white/5",
              ].join(" ")}
            >
              <p className="text-sm font-medium text-slate-200">{plan.name}</p>
              <p className="mt-3 text-3xl font-semibold text-white">{formatPrice(plan.priceDkk)}</p>
              <p className="mt-1 text-sm text-slate-300">{plan.tickets} / month</p>

              <ul className="mt-6 space-y-2 text-sm text-slate-200">
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-300" />
                  Sona Inbox included
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-300" />
                  AI drafts og workflow automation
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 text-emerald-300" />
                  Shopify integration
                </li>
              </ul>

              <Button asChild className="mt-6 w-full">
                <Link href="/sign-up">Start free trial</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
