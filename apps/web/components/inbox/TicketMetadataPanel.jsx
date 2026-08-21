"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Plus } from "lucide-react";

const metadataCache = new Map();
const assignedTagsCache = new Map();
let availableTagsCache = null;

function SectionLabel({ children }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {children}
      </span>
    </div>
  );
}

function EditableTextField({ label, value, onSave, placeholder = "—" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) textareaRef.current.focus();
  }, [editing]);

  const handleBlur = () => {
    setEditing(false);
    const next = draft.trim();
    const current = (value ?? "").trim();
    if (next !== current) onSave(next || null);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.currentTarget.blur();
    }
  };

  return (
    <div className="space-y-1.5">
      <SectionLabel>{label}</SectionLabel>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label={`Edit ${label.toLowerCase()}`}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`block w-full text-left rounded-md px-2 -mx-2 py-1 text-[13px] leading-5 hover:bg-muted/55 active:scale-[0.99] transition-[transform,background-color] duration-150 ease-out min-h-[28px] ${
            value ? "text-foreground" : "text-muted-foreground italic"
          }`}
        >
          {value || placeholder}
        </button>
      )}
    </div>
  );
}

function ProductField({ value, availableProducts, onSave }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const filtered = (availableProducts ?? []).filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-1.5">
      <SectionLabel>Product</SectionLabel>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setSearch(""); }}
          className={`block w-full text-left rounded-md px-2 -mx-2 py-1 text-[13px] leading-5 hover:bg-muted/55 active:scale-[0.99] transition-[transform,background-color] duration-150 ease-out min-h-[28px] ${
            value ? "text-foreground" : "text-muted-foreground italic"
          }`}
        >
          {value?.title || "Add product"}
        </button>
        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 flex min-w-[200px] max-h-56 flex-col rounded-lg border border-border bg-background py-1 shadow-lg">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mx-2 my-1 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="overflow-y-auto flex-1">
              <button
                type="button"
                onClick={() => { onSave(null); setOpen(false); }}
                className="flex w-full items-center px-3 py-1.5 text-left text-sm italic text-muted-foreground transition-[transform,background-color] duration-100 ease-out hover:bg-muted active:scale-[0.98]"
              >
                None
              </button>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSave(p.id); setOpen(false); }}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-[transform,background-color] duration-100 ease-out hover:bg-muted active:scale-[0.98] ${
                    value?.id === p.id ? "font-medium text-violet-700" : "text-foreground"
                  }`}
                >
                  {p.title}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">No products found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ tag, onRemove, isRemoving }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 py-[3px] pl-2.5 pr-1 text-xs font-medium text-orange-600"
      title={tag.source === "ai" ? "Set by AI" : "Set manually"}
    >
      {tag.name}
      <button
        type="button"
        onClick={() => onRemove(tag)}
        disabled={isRemoving}
        className="ml-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full opacity-50 transition-[transform,background-color] duration-100 ease-out hover:bg-orange-200/60 hover:opacity-100 active:scale-90 disabled:opacity-30"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

function TagsSection({ threadId }) {
  const [assignedTags, setAssignedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [adding, setAdding] = useState(null);
  const [removing, setRemoving] = useState(null);
  const dropdownRef = useRef(null);

  const fetchAssigned = useCallback(async () => {
    if (!threadId) return;
    if (assignedTagsCache.has(threadId)) {
      setAssignedTags(assignedTagsCache.get(threadId));
      return;
    }
    const res = await fetch(`/api/threads/${threadId}/tags`).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) {
      const tags = json.tags ?? [];
      assignedTagsCache.set(threadId, tags);
      setAssignedTags(tags);
    }
  }, [threadId]);

  const fetchAvailable = useCallback(async () => {
    if (availableTagsCache) {
      setAvailableTags(availableTagsCache);
      return;
    }
    const res = await fetch("/api/settings/tags").catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) {
      availableTagsCache = (json.tags ?? []).filter((t) => t.is_active);
      setAvailableTags(availableTagsCache);
    }
  }, []);

  useEffect(() => {
    setAssignedTags([]);
    fetchAssigned();
  }, [fetchAssigned, threadId]);

  useEffect(() => { fetchAvailable(); }, [fetchAvailable]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handle = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [dropdownOpen]);

  const handleAdd = useCallback(async (tag) => {
    if (adding) return;
    setDropdownOpen(false);
    setAdding(tag.id);
    const res = await fetch(`/api/threads/${threadId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tag.id }),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setAssignedTags((prev) => {
        const next = prev.some((t) => t.id === json.tag.id)
          ? prev
          : [...prev, json.tag];
        assignedTagsCache.set(threadId, next);
        return next;
      });
    }
    setAdding(null);
  }, [adding, threadId]);

  const handleRemove = useCallback(async (tag) => {
    if (removing) return;
    setRemoving(tag.id);
    await fetch(`/api/threads/${threadId}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_id: tag.id }),
    }).catch(() => null);
    setAssignedTags((prev) => {
      const next = prev.filter((t) => t.id !== tag.id);
      assignedTagsCache.set(threadId, next);
      return next;
    });
    setRemoving(null);
  }, [removing, threadId]);

  const assignedIds = new Set(assignedTags.map((t) => t.id));
  const unassigned = availableTags.filter((t) => !assignedIds.has(t.id));

  return (
    <div className="space-y-1.5">
      <SectionLabel>Tags</SectionLabel>
      <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
        {assignedTags.map((tag) => (
          <Tag
            key={tag.id}
            tag={tag}
            onRemove={handleRemove}
            isRemoving={removing === tag.id}
          />
        ))}
        {unassigned.length > 0 && (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-orange-300 px-2 py-[3px] text-[11px] font-medium text-orange-600 transition-[transform,color,border-color,background-color] duration-150 ease-out hover:border-orange-400 hover:bg-orange-50 active:scale-[0.97]"
            >
              <Plus className="w-3 h-3" />
              Tag
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 max-h-48 min-w-[160px] overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg">
                {unassigned.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAdd(tag)}
                    disabled={adding === tag.id}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-[transform,background-color] duration-100 ease-out hover:bg-muted active:scale-[0.98] disabled:opacity-50"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {assignedTags.length === 0 && unassigned.length === 0 ? (
          <span className="py-1 text-[12px] italic text-muted-foreground">No tags yet</span>
        ) : null}
      </div>
    </div>
  );
}

function ReadOnlyTag({ tag }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-medium text-orange-700"
      title={tag.source === "ai" ? "Set by AI" : "Set manually"}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/**
 * Compact, read-only metadata for the first sidebar view.
 * Editing remains in TicketMetadataPanel so the overview stays scannable.
 */
export function TicketMetadataSnapshot({ threadId }) {
  const [metadata, setMetadata] = useState(null);
  const [assignedTags, setAssignedTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  useEffect(() => {
    setSummaryExpanded(false);
  }, [threadId]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!threadId) {
        setMetadata(null);
        setAssignedTags([]);
        setLoading(false);
        return;
      }

      const cachedMetadata = metadataCache.get(threadId);
      const cachedTags = assignedTagsCache.get(threadId);
      if (cachedMetadata) setMetadata(cachedMetadata);
      if (cachedTags) setAssignedTags(cachedTags);
      setLoading(!cachedMetadata && !cachedTags);

      const metadataRequest = cachedMetadata
        ? Promise.resolve(cachedMetadata)
        : fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null);
      const tagsRequest = cachedTags
        ? Promise.resolve(cachedTags)
        : fetch(`/api/threads/${encodeURIComponent(threadId)}/tags`)
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => json?.tags ?? [])
            .catch(() => []);

      const [nextMetadata, nextTags] = await Promise.all([metadataRequest, tagsRequest]);
      if (!active) return;
      if (nextMetadata) {
        metadataCache.set(threadId, nextMetadata);
        setMetadata(nextMetadata);
      }
      if (Array.isArray(nextTags)) {
        assignedTagsCache.set(threadId, nextTags);
        setAssignedTags(nextTags);
      }
      setLoading(false);
    };

    load();
    return () => {
      active = false;
    };
  }, [threadId]);

  const summary = typeof metadata?.issue_summary === "string" ? metadata.issue_summary.trim() : "";
  const canExpandSummary = summary.length > 180;

  return (
    <div className="space-y-2.5">
      <section className="space-y-1.5 border-b border-border/70 pb-2.5">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>Summary</SectionLabel>
          {canExpandSummary ? (
            <button
              type="button"
              onClick={() => setSummaryExpanded((value) => !value)}
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              {summaryExpanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
        {loading && !metadata ? (
          <div className="h-9 animate-pulse rounded-md bg-muted/55" aria-label="Loading summary" />
        ) : (
          <p
            className={`${summaryExpanded ? "" : "line-clamp-2"} text-[12px] leading-[1.45] ${summary ? "text-foreground" : "text-muted-foreground italic"}`}
            title={summary || undefined}
          >
            {summary || "No summary yet"}
          </p>
        )}
      </section>

      {metadata?.detected_product?.title ? (
        <section className="space-y-1.5 border-b border-border/70 pb-2.5">
          <SectionLabel>Product</SectionLabel>
          <p className="truncate text-[12px] leading-[1.45] text-foreground" title={metadata.detected_product.title}>
            {metadata.detected_product.title}
          </p>
        </section>
      ) : null}

      {assignedTags.length > 0 ? (
        <section className="space-y-1.5 border-b border-border/70 pb-2.5">
          <SectionLabel>Tags</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {assignedTags.map((tag) => <ReadOnlyTag key={tag.id} tag={tag} />)}
          </div>
        </section>
      ) : null}

      {typeof metadata?.solution_summary === "string" && metadata.solution_summary.trim() ? (
        <section className="space-y-1.5 border-b border-border/70 pb-2.5">
          <SectionLabel>Solution</SectionLabel>
          <p className="line-clamp-2 text-[12px] leading-[1.45] text-foreground" title={metadata.solution_summary.trim()}>
            {metadata.solution_summary.trim()}
          </p>
        </section>
      ) : null}
    </div>
  );
}

export function TicketMetadataPanel({ threadId }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMetadata = useCallback(async () => {
    if (!threadId) return;
    if (metadataCache.has(threadId)) {
      setMetadata(metadataCache.get(threadId));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        metadataCache.set(threadId, json);
        setMetadata(json);
      }
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    setMetadata(null);
    fetchMetadata();
  }, [fetchMetadata, threadId]);

  const handleSave = useCallback(async (field, value) => {
    const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      setMetadata((prev) => {
        if (!prev) return prev;
        if (field === "detected_product_id") {
          const product = (prev.available_products ?? []).find((p) => p.id === value) ?? null;
          const next = { ...prev, detected_product: product };
          metadataCache.set(threadId, next);
          return next;
        }
        const next = { ...prev, [field]: value };
        metadataCache.set(threadId, next);
        return next;
      });
    }
  }, [threadId]);

  if (loading) {
    return <div className="py-5 text-center text-xs text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-2.5">
      <div className="border-b border-border/70 pb-2.5">
        <EditableTextField
          label="Summary"
          value={metadata?.issue_summary}
          onSave={(v) => handleSave("issue_summary", v)}
          placeholder="Add a short summary"
        />
      </div>
      <div className="border-b border-border/70 pb-2.5">
        <ProductField
          value={metadata?.detected_product}
          availableProducts={metadata?.available_products ?? []}
          onSave={(productId) => handleSave("detected_product_id", productId)}
        />
      </div>
      <div className="border-b border-border/70 pb-2.5">
        <TagsSection threadId={threadId} />
      </div>
      <EditableTextField
        label="Solution"
        value={metadata?.solution_summary}
        onSave={(v) => handleSave("solution_summary", v)}
        placeholder="Add a solution summary"
      />
    </div>
  );
}
