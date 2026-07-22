"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KnowledgeDocumentOutline({
  sections,
  activeSectionId,
  onSelectSection,
  loading = false,
}) {
  if (loading) {
    return (
      <div className="h-full space-y-2 rounded-xl border bg-card p-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }

  const items = Array.isArray(sections) ? sections : [];

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sections
          </h3>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Each section heading below becomes a focused knowledge unit the AI retrieves from.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          Add a section heading to structure this guide.
        </p>
      ) : (
        <nav className="flex-1 overflow-y-auto p-2">
          {items.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection?.(section.id)}
              title={section.title}
              className={cn(
                "block w-full truncate rounded-md px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                activeSectionId === section.id && "bg-muted font-medium text-foreground",
              )}
            >
              {section.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
