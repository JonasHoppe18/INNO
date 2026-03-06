"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganizationList } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function StepDots({ current }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-2">
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={`h-2 rounded-full ${
            current === step ? "w-8 bg-indigo-600" : "w-2 bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingWelcomePage() {
  const router = useRouter();
  const { orgId } = useAuth();
  const { isLoaded, createOrganization, setActive } = useOrganizationList();
  const [shopName, setShopName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [bootstrapping, setBootstrapping] = useState(true);

  const canContinue = useMemo(() => shopName.trim().length > 1, [shopName]);

  useEffect(() => {
    let active = true;

    const routeExistingOrgToNextStep = async () => {
      if (!orgId) {
        if (active) setBootstrapping(false);
        return;
      }

      const response = await fetch("/api/onboarding/state", { cache: "no-store" }).catch(
        () => null
      );
      const payload = response?.ok ? await response.json().catch(() => null) : null;
      const steps = payload?.steps || {};

      if (!active) return;

      if (!steps?.shopify_connected) {
        router.replace("/onboarding/shopify");
        return;
      }
      if (!steps?.email_connected) {
        router.replace("/onboarding/email");
        return;
      }
      router.replace("/inbox");
    };

    routeExistingOrgToNextStep().catch(() => {
      if (!active) return;
      if (orgId) {
        router.replace("/onboarding/shopify");
        return;
      }
      setBootstrapping(false);
    });

    return () => {
      active = false;
    };
  }, [orgId, router]);

  const handleContinue = async () => {
    const trimmed = shopName.trim();
    if (!trimmed) return;
    setError("");
    setSubmitting(true);
    try {
      window.localStorage.setItem("sona_onboarding_shop_name", trimmed);
    } catch (_error) {
      // noop
    }
    try {
      if (!orgId) {
        if (!isLoaded || typeof createOrganization !== "function") {
          throw new Error("Organization service is still loading. Try again.");
        }
        const organization = await createOrganization({ name: trimmed });
        if (organization?.id && typeof setActive === "function") {
          await setActive({ organization: organization.id });
        }
      }
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create organization. Try again."
      );
      setSubmitting(false);
      return;
    }
    router.push("/onboarding/shopify");
  };

  if (bootstrapping) {
    return (
      <div className="mx-auto flex w-full max-w-md items-center justify-center py-20 text-sm text-slate-500">
        Loading onboarding...
      </div>
    );
  }

  return (
    <div className="sona-onboarding-shell mx-auto w-full max-w-md">
      <StepDots current={1} />
      <div className="mt-6 space-y-2 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Welcome to Sona</h1>
        <p className="mb-8 text-slate-500">
          Let&apos;s set up your workspace. What is the name of your shop?
        </p>
      </div>

      <div className="space-y-3">
        <label htmlFor="shop-name" className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Shop Name
        </label>
        <Input
          id="shop-name"
          value={shopName}
          onChange={(event) => setShopName(event.target.value)}
          placeholder="e.g. Sona"
          className="h-12 w-full rounded-xl border-slate-300 text-lg shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
        />
      </div>

      <Button
        type="button"
        className="mt-6 h-12 w-full transform rounded-xl bg-indigo-700 font-semibold text-white shadow-lg shadow-indigo-700/30 transition-all hover:bg-indigo-800 active:scale-95"
        disabled={!canContinue || submitting}
        onClick={handleContinue}
      >
        {submitting ? "Creating workspace..." : "Continue"}
      </Button>
      {error ? <p className="mt-3 text-center text-sm text-red-600">{error}</p> : null}

      <style jsx>{`
        .sona-onboarding-shell {
          animation: fade-in-up 420ms ease-out;
        }
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
