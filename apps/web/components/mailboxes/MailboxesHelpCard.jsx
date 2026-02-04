"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImapGuideModal } from "@/components/integrations/ImapGuideModal";

export function MailboxesHelpCard({ variant = "default" }) {
  const [isOpen, setIsOpen] = useState(false);
  const isCompact = variant === "compact";

  return (
    <>
      <div
        className={
          isCompact
            ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            : "rounded-2xl border border-blue-200 bg-blue-50 p-6 text-blue-900 shadow-sm"
        }
      >
        <div className="flex items-start gap-3">
          <div
            className={
              isCompact
                ? "flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white"
                : "flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-white"
            }
          >
            <BookOpen
              className={isCompact ? "h-4 w-4 text-gray-500" : "h-5 w-5 text-blue-700"}
            />
          </div>
          <div>
            <h3 className={isCompact ? "text-sm font-semibold text-gray-700" : "text-base font-semibold"}>
              Using One.com, Simply, or others?
            </h3>
            <p
              className={
                isCompact
                  ? "mt-1 text-sm text-gray-500"
                  : "mt-1 text-sm text-blue-800/80"
              }
            >
              You can use Sona with any provider by connecting via a Gmail proxy.
              It&apos;s free, secure, and gives you better spam filtering.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant={isCompact ? "outline" : "default"}
          className={isCompact ? "w-full sm:w-auto" : "w-full bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"}
          onClick={() => setIsOpen(true)}
        >
          View Setup Guide
        </Button>
      </div>

      <ImapGuideModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
