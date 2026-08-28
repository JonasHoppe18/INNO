import { Skeleton } from "@/components/ui/skeleton";

const TICKET_ROW_WIDTHS = [
  ["w-32", "w-24"],
  ["w-36", "w-28"],
  ["w-28", "w-32"],
  ["w-40", "w-20"],
  ["w-32", "w-28"],
  ["w-36", "w-24"],
  ["w-28", "w-36"],
  ["w-40", "w-28"],
];

function SkeletonTicketRow({ index }) {
  const [senderWidth, subjectWidth] = TICKET_ROW_WIDTHS[index % TICKET_ROW_WIDTHS.length];

  return (
    <div className="flex h-[68px] flex-col justify-center gap-1.5 px-3">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className={`h-3.5 ${senderWidth}`} />
        <Skeleton className="h-3 w-9 shrink-0" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className={`h-3 ${subjectWidth}`} />
        <Skeleton className="h-3 w-8 shrink-0" />
      </div>
    </div>
  );
}

function SkeletonConversationBubble({ align = "left", lines = 3 }) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div className="w-full max-w-[620px] rounded-2xl border border-border/60 bg-background p-4 shadow-[0_2px_8px_hsl(var(--foreground)/0.025)]">
        <Skeleton className="mb-3 h-3 w-28" />
        <div className="space-y-2">
          {Array.from({ length: lines }).map((_, index) => (
            <Skeleton
              key={index}
              className={`h-3 ${index === lines - 1 ? "w-7/12" : index % 2 ? "w-10/12" : "w-11/12"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonComposer() {
  return (
    <div className="relative z-20 px-3 pb-4 pt-2 sm:px-4">
      <div className="mx-auto w-full max-w-[900px] rounded-3xl border border-border/70 bg-background px-4 py-3 shadow-[0_8px_28px_hsl(var(--foreground)/0.07)] sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-5" />
            <Skeleton className="h-3 w-6" />
            <Skeleton className="size-3" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-8/12" />
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxLoadingSkeleton() {
  return (
    <div className="inbox-theme flex min-h-0 flex-1 overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-hidden bg-muted/20">
        <aside className="flex min-h-0 w-[clamp(14.5rem,16vw,19rem)] shrink-0 flex-col border-r border-border/60 bg-background">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 px-3">
            <div className="relative min-w-0 flex-1">
              <Skeleton className="h-8 w-full rounded-md bg-primary/[0.07]" />
            </div>
            <Skeleton className="h-5 w-14 rounded-md bg-primary/[0.07]" />
          </div>
          <div className="min-h-0 flex-1 divide-y divide-border/50 overflow-hidden">
            {Array.from({ length: 9 }).map((_, index) => (
              <SkeletonTicketRow key={index} index={index} />
            ))}
          </div>
          <div className="flex h-10 shrink-0 items-center justify-center border-t border-border/55">
            <Skeleton className="h-3 w-20 bg-primary/[0.07]" />
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-muted/20">
          <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/95 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <Skeleton className="h-3.5 w-12 bg-primary/[0.07]" />
              <Skeleton className="h-7 w-24 rounded-lg bg-primary/[0.07]" />
              <Skeleton className="h-7 w-32 rounded-lg bg-primary/[0.07]" />
              <Skeleton className="h-7 w-20 rounded-lg bg-primary/[0.07]" />
            </div>
            <Skeleton className="h-7 w-20 rounded-lg bg-primary/[0.07]" />
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-3 px-3 pb-4 pt-4 sm:px-4">
              <SkeletonConversationBubble lines={4} />
              <SkeletonConversationBubble align="right" lines={3} />
              <SkeletonConversationBubble lines={3} />
            </div>
          </div>

          <SkeletonComposer />
        </section>
      </div>
    </div>
  );
}
