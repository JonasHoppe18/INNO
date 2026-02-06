"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function MailboxesOnboardingTracker() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasRun = useRef(false);
  const success = searchParams?.get("success") === "true";

  useEffect(() => {
    if (!success || hasRun.current) return;
    hasRun.current = true;
    const mark = async () => {
      await fetch("/api/onboarding/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "email_connected" }),
      }).catch(() => null);
      router.replace("/mailboxes");
    };
    mark();
  }, [success, router]);

  return null;
}
