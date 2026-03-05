"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

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

function GoogleLogo({ className = "h-7 w-7" }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.655 32.657 29.24 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.84 1.154 7.955 3.045l5.657-5.657C34.046 6.053 29.273 4 24 4 12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20c0-1.341-.138-2.651-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.84 1.154 7.955 3.045l5.657-5.657C34.046 6.053 29.273 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.17 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.148 35.092 26.678 36 24 36c-5.22 0-9.623-3.327-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.084 5.571l.003-.002 6.19 5.238C36.972 39.205 44 34 44 24c0-1.341-.138-2.651-.389-3.917z"
      />
    </svg>
  );
}

function MicrosoftLogo({ className = "h-7 w-7" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" fill="#F25022" />
      <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
      <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function ProviderCard({ label, logo, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-36 w-full flex-col items-center justify-center gap-3 rounded-xl bg-white text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50">
        {logo}
      </div>
      <p className="text-sm font-semibold text-slate-800">{label}</p>
    </button>
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

  const handleSkipCustom = async () => {
    router.push("/mailboxes/other");
  };

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

          <div className="grid grid-cols-2 gap-4">
            <ProviderCard
              label="Gmail / Workspace"
              logo={<GoogleLogo />}
              onClick={() => {
                router.push("/mailboxes/other");
              }}
            />
            <ProviderCard
              label="Outlook / 365"
              logo={<MicrosoftLogo />}
              onClick={() => {
                router.push("/mailboxes/other");
              }}
            />
          </div>

          <button
            type="button"
            className="mt-5 w-full text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline"
            onClick={handleSkipCustom}
            disabled={loading}
          >
            Set up forwarding (One.com, Simply, Gmail, Outlook, etc.)
          </button>
          <button
            type="button"
            className="mt-2 w-full text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline"
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
