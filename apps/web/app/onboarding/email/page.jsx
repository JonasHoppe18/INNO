"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { MailboxesAddMenu } from "@/components/mailboxes/MailboxesAddMenu";

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

export default function OnboardingEmailPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState("");

  const loadState = async () => {
    setLoading(true);
    const response = await fetch("/api/onboarding/state", { cache: "no-store" }).catch(
      () => null
    );
    const payload = response?.ok ? await response.json().catch(() => null) : null;
    const isConnected = Boolean(payload?.steps?.email_connected);
    setConnected(isConnected);
    setEmail(String(payload?.connected_mail_account?.email || ""));
    setLoading(false);
    return isConnected;
  };

  useEffect(() => {
    loadState().catch(() => setLoading(false));
  }, []);

  return (
    <div className="sona-onboarding-shell mx-auto w-full max-w-md">
      <StepDots current={3} />

      {connected ? (
        <>
          <div className="mt-6 space-y-2 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Email connected</h1>
            <p className="mb-8 text-slate-500">Sona can now draft replies from your support inbox.</p>
          </div>

          <div className="flex flex-col items-center rounded-xl bg-white p-6">
            <div className="mb-2 h-4 w-4" aria-hidden="true" />
            <p className="text-center text-lg font-semibold text-gray-900">{email || "Connected inbox"}</p>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              <Check className="h-3 w-3" />
              Connected
            </div>
          </div>

          <Button
            type="button"
            className="mt-6 h-12 w-full rounded-xl bg-indigo-700 font-semibold text-white shadow-lg shadow-indigo-700/30 transition-all hover:bg-indigo-800 active:scale-95"
            onClick={() => router.push("/inbox")}
          >
            Finish Setup
          </Button>
        </>
      ) : (
        <>
          <div className="mt-6 space-y-2 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Connect your support email</h1>
            <p className="mb-8 text-slate-500">
              All providers use forwarding, including Gmail and Outlook.
            </p>
          </div>

          <div className="mx-auto w-full max-w-sm">
            <MailboxesAddMenu buttonClassName="h-12 w-full rounded-xl bg-indigo-700 font-semibold text-white shadow-lg shadow-indigo-700/30 transition-all hover:bg-indigo-800 active:scale-95 lg:w-full" />
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            Need help setting up forwarding?{" "}
            <a
              href="/guide/connect-mail"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Open guide
            </a>
          </p>
          <button
            type="button"
            className="mt-3 w-full text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline"
            onClick={() => router.push("/inbox")}
          >
            Skip for now
          </button>
        </>
      )}

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
