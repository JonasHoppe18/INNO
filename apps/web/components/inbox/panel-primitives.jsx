import { ChevronRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assigneeInitials,
  CANONICAL_STATUS_OPTIONS,
  canonicalStatusOption,
} from "@/lib/inbox/view-model";

// Shared building blocks for the ticket details panel (overview + profile).

export function PanelSection({ title, action = null, children }) {
  return (
    <section className="border-b border-border/60 px-1 py-3 last:border-b-0">
      {title ? (
        <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function PanelLinkButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
    </button>
  );
}

export function PropertyRow({ label, children }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

// Same rule as the inbox list: two initials for a real name, one letter for a
// bare email, a mail glyph for no-reply senders.
export function CustomerAvatar({ name = "", email = "", className = "size-9 text-xs" }) {
  const label = String(name || email || "").trim();
  const isEmail = label.includes("@");
  const isNoReply = /^(no-?reply|do-?not-?reply|mailer-daemon)/i.test(String(email || label));
  const initials = isEmail
    ? (label.match(/[a-z0-9]/i)?.[0] || "?").toUpperCase()
    : assigneeInitials(label) || "?";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
        className,
      )}
    >
      {isNoReply ? <Mail className="h-4 w-4" /> : initials}
    </span>
  );
}

export const ticketStatusLabel = (status) =>
  CANONICAL_STATUS_OPTIONS.find((option) => option.value === canonicalStatusOption({ status }))?.label ||
  "Needs attention";
