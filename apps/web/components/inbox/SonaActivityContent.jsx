"use client";

import { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Expandable row ──────────────────────────────────────────────
function ExpandItem({ title, preview, right, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card")}>
      <button
        className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {preview && (
            <div className={cn("mt-0.5 truncate text-xs text-muted-foreground transition-opacity", open && "opacity-0")}>
              {preview}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{right}</div>
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150", open && "rotate-90 text-foreground")}
        />
      </button>
      {/* CSS grid-rows accordion — smooth, no JS height measurement */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border bg-muted/40 px-3.5 py-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Score pill ──────────────────────────────────────────────────
function ScorePill({ score }) {
  const isHigh = score >= 0.8;
  return (
    <span
      className={cn(
        "rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
        isHigh
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      {score.toFixed(2)}
    </span>
  );
}

// ── Section label ───────────────────────────────────────────────
function SectionLabel({ children, count, countClass }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
        {children}
      </span>
      {count != null && (
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
            countClass ?? "border-border bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ── "Add to KB" inline form ─────────────────────────────────────
function AddToKbForm({ gap, shopId, onSaved, onCancel }) {
  const [title, setTitle] = useState(gap.suggested_title ?? "");
  const [content, setContent] = useState(gap.suggested_content_hint ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), shop_id: shopId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-background p-3">
      <input
        className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); setError(null); }}
      />
      <textarea
        className="h-20 w-full resize-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Describe the policy or procedure…"
        value={content}
        onChange={(e) => { setContent(e.target.value); setError(null); }}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          disabled={saving || !title.trim() || !content.trim()}
          className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-[transform,opacity] active:scale-[0.97] disabled:opacity-50"
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save to knowledge base"}
        </button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────
export function SonaActivityContent({ diagnostic, shopId }) {
  const [addingGapId, setAddingGapId] = useState(null);
  const [savedGapIds, setSavedGapIds] = useState(new Set());

  if (!diagnostic) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  const { reasoning, kb_chunks = [], ticket_examples = [], knowledge_gaps = [] } = diagnostic;
  const hasContent = reasoning || kb_chunks.length || ticket_examples.length || knowledge_gaps.length;

  if (!hasContent) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No activity recorded for this conversation.
      </p>
    );
  }

  return (
    <div className="space-y-5">

      {/* Why this draft */}
      {reasoning && (
        <section>
          <SectionLabel>Why this draft</SectionLabel>
          <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm leading-relaxed text-foreground/80">
            {reasoning}
          </p>
        </section>
      )}

      {/* Knowledge used */}
      {kb_chunks.length > 0 && (
        <section>
          <SectionLabel count={kb_chunks.length}>Knowledge used</SectionLabel>
          <div className="space-y-1.5">
            {kb_chunks.map((chunk, i) => (
              <ExpandItem
                key={chunk.id ?? i}
                title={chunk.title}
                preview={`"${(chunk.content ?? "").slice(0, 60)}…"`}
                right={<ScorePill score={chunk.score} />}
              >
                <p className="mb-2.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                  {chunk.content ?? ""}
                </p>
                <div className="flex flex-wrap gap-3">
                  {chunk.usable_as && (
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">Type</span> {chunk.usable_as}
                    </span>
                  )}
                  {chunk.kind && (
                    <span className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">Kind</span> {chunk.kind}
                    </span>
                  )}
                </div>
              </ExpandItem>
            ))}
          </div>
        </section>
      )}

      {/* Similar previous emails */}
      {ticket_examples.length > 0 && (
        <section>
          <SectionLabel count={ticket_examples.length}>Similar previous emails</SectionLabel>
          <div className="space-y-1.5">
            {ticket_examples.map((ticket, i) => (
              <ExpandItem
                key={i}
                title={ticket.subject ?? `Previous email ${i + 1}`}
                preview={`"${(ticket.customer_msg ?? "").slice(0, 60)}…"`}
                right={
                  <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {ticket.score?.toFixed(2)}
                  </span>
                }
              >
                <div className="space-y-2">
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Customer</p>
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground/80">
                      {ticket.customer_msg ?? ""}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your reply</p>
                    <p className="whitespace-pre-wrap rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground/80">
                      {ticket.agent_reply ?? ""}
                    </p>
                  </div>
                </div>
              </ExpandItem>
            ))}
          </div>
        </section>
      )}

      {/* Missing knowledge */}
      {knowledge_gaps.length > 0 && (
        <section>
          <SectionLabel
            count={knowledge_gaps.length}
            countClass="border-amber-200 bg-amber-50 text-amber-700"
          >
            Missing knowledge
          </SectionLabel>
          <div className="space-y-2">
            {knowledge_gaps.map((gap, i) => {
              const gapId = `${gap.gap_type}-${i}`;
              const isSaved = savedGapIds.has(gapId);
              const isAdding = addingGapId === gapId;
              return (
                <div
                  key={gapId}
                  className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3"
                >
                  <p className="mb-1 text-sm font-semibold text-amber-900">
                    {gap.suggested_title || gap.gap_type}
                  </p>
                  <p className="mb-2.5 text-xs leading-relaxed text-amber-800/80">
                    {gap.suggested_content_hint}
                  </p>
                  {isSaved ? (
                    <p className="text-xs font-medium text-green-700">✓ Saved to knowledge base</p>
                  ) : isAdding ? (
                    <AddToKbForm
                      gap={gap}
                      shopId={shopId}
                      onSaved={() => {
                        setSavedGapIds((prev) => new Set([...prev, gapId]));
                        setAddingGapId(null);
                      }}
                      onCancel={() => setAddingGapId(null)}
                    />
                  ) : (
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-[transform] active:scale-[0.97]"
                      onClick={() => setAddingGapId(gapId)}
                    >
                      <Plus className="h-3 w-3" />
                      Add to knowledge base
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
}
