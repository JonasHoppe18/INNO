"use client";

import Image from "next/image";
import { Mail, Server, Settings, UserPlus, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import gmailLogo from "../../../../assets/Gmail-logo.webp";

const steps = [
  {
    title: "Create a Gmail",
    description:
      "Use a free Gmail account (e.g. support.yourstore@gmail.com) to act as the engine.",
    icon: UserPlus,
  },
  {
    title: "Configure in Gmail",
    description:
      "Go to Settings ⚙️ > Accounts and Import > Check mail from other accounts.",
    icon: Settings,
  },
  {
    title: "Add your Details",
    description:
      "Enter your hosting details (POP3/SMTP from One.com/Simply). This lets Gmail send & receive as your domain.",
    icon: Server,
  },
  {
    title: "Connect to Sona",
    description:
      "Come back here and simply click 'Add Mailbox' → 'Gmail'.",
    icon: Zap,
  },
];

export function ImapGuideModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
              <Image
                src={gmailLogo}
                alt="Gmail logo"
                width={32}
                height={32}
                className="object-contain"
              />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                Connect Custom Domain via Gmail
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Get Sona AI on your custom email (e.g. info@shop.com) in 3 minutes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:text-slate-700"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-8 space-y-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isLast = index === steps.length - 1;
            return (
              <div key={step.title} className="relative flex gap-4">
                <div className="relative flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm">
                    <Icon className="h-5 w-5" />
                  </div>
                  {!isLast ? (
                    <span className="mt-2 h-full w-px flex-1 bg-slate-200" />
                  ) : null}
                </div>
                <div className="flex-1 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    {index + 1}. {step.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p>
            <span className="font-semibold">💡 Pro Tip:</span> This gives you Gmail&apos;s
            superior spam filtering and search, while your customers still only see your
            professional info@ address.
          </p>
        </div>

        <div className="mt-6 flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
          <a
            href="https://support.google.com/mail/answer/21289?hl=en"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-slate-500 transition hover:text-slate-700"
          >
            Read official Google Guide ↗
          </a>
          <Button
            type="button"
            className="w-full bg-slate-900 text-white hover:bg-slate-800 sm:w-auto"
            onClick={onClose}
          >
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
