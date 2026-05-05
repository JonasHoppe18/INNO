"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Plus } from "lucide-react";

function SectionLabel({ children, isAI = false }) {
  return (
    <div className="flex items-center gap-1.5">
      {isAI && <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />}
      <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400/80">
        {children}
      </span>
    </div>
  );
}

function EditableTextField({ label, value, onSave, placeholder = "—", isAI = false }) {
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

  return (
    <div className="space-y-1.5">
      <SectionLabel isAI={isAI && Boolean(value)}>{label}</SectionLabel>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`block w-full text-left rounded-md px-2 -mx-2 py-1 text-sm hover:bg-slate-50 active:scale-[0.99] transition-[transform,background-color] duration-150 ease-out min-h-[28px] ${
            value ? "text-slate-800" : "text-slate-400 italic"
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
      <SectionLabel isAI={Boolean(value)}>Product</SectionLabel>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); setSearch(""); }}
          className={`block w-full text-left rounded-md px-2 -mx-2 py-1 text-sm hover:bg-slate-50 active:scale-[0.99] transition-[transform,background-color] duration-150 ease-out min-h-[28px] ${
            value ? "text-slate-800" : "text-slate-400 italic"
          }`}
        >
          {value?.title || "—"}
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px] max-h-56 flex flex-col">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mx-2 my-1 px-2 py-1 text-sm border border-slate-200 rounded focus:outline-none"
            />
            <div className="overflow-y-auto flex-1">
              <button
                type="button"
                onClick={() => { onSave(null); setOpen(false); }}
                className="flex items-center w-full px-3 py-1.5 text-sm text-slate-400 italic hover:bg-slate-50 active:scale-[0.98] transition-[transform,background-color] duration-100 ease-out"
              >
                None
              </button>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSave(p.id); setOpen(false); }}
                  className={`flex items-center w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 active:scale-[0.98] transition-[transform,background-color] duration-100 ease-out ${
                    value?.id === p.id ? "font-medium text-violet-700" : "text-slate-700"
                  }`}
                >
                  {p.title}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">No products found.</p>
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
    const res = await fetch(`/api/threads/${threadId}/tags`).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) setAssignedTags(json.tags ?? []);
  }, [threadId]);

  const fetchAvailable = useCallback(async () => {
    const res = await fetch("/api/settings/tags").catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (res?.ok) setAvailableTags((json.tags ?? []).filter((t) => t.is_active));
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
      setAssignedTags((prev) =>
        prev.some((t) => t.id === json.tag.id) ? prev : [...prev, json.tag]
      );
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
    setAssignedTags((prev) => prev.filter((t) => t.id !== tag.id));
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
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-48 overflow-y-auto">
                {unassigned.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAdd(tag)}
                    disabled={adding === tag.id}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 active:scale-[0.98] transition-[transform,background-color] duration-100 ease-out disabled:opacity-50"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {assignedTags.length === 0 && unassigned.length === 0 && (
          <span className="text-sm text-slate-400 italic">—</span>
        )}
      </div>
    </div>
  );
}

export function TicketMetadataPanel({ threadId }) {
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMetadata = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/metadata`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setMetadata(json);
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
          return { ...prev, detected_product: product };
        }
        return { ...prev, [field]: value };
      });
    }
  }, [threadId]);

  if (loading) {
    return <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>;
  }

  return (
    <div>
      <div className="pb-4">
        <EditableTextField
          label="Summary"
          value={metadata?.issue_summary}
          onSave={(v) => handleSave("issue_summary", v)}
          placeholder="Click to edit"
          isAI
        />
      </div>
      <div className="py-4 border-t border-slate-100">
        <ProductField
          value={metadata?.detected_product}
          availableProducts={metadata?.available_products ?? []}
          onSave={(productId) => handleSave("detected_product_id", productId)}
        />
      </div>
      <div className="py-4 border-t border-slate-100">
        <TagsSection threadId={threadId} />
      </div>
      <div className="pt-4 border-t border-slate-100">
        {(() => {
          const status = String(metadata?.status ?? "").toLowerCase();
          const isSolved = status === "solved" || status === "resolved";
          return (
            <EditableTextField
              label="Solution"
              value={isSolved ? metadata?.solution_summary : null}
              onSave={(v) => handleSave("solution_summary", v)}
              placeholder={isSolved ? "Click to edit" : "Generated when ticket is solved"}
            />
          );
        })()}
      </div>
    </div>
  );
}
