"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sparkles } from "lucide-react";

function TagBadge({ tag, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white select-none"
      style={{ backgroundColor: tag.color }}
      title={tag.source === "ai" ? "Sat af AI" : "Sat manuelt"}
    >
      {tag.source === "ai" && <Sparkles className="w-2.5 h-2.5 opacity-80 shrink-0" />}
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(tag)}
          className="ml-0.5 opacity-70 hover:opacity-100 leading-none text-white"
          aria-label={`Fjern tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function ThreadTagsBar({ threadId, refreshTrigger }) {
  const [assignedTags, setAssignedTags] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(null);
  const [removing, setRemoving] = useState(null);
  const dropdownRef = useRef(null);

  const fetchAssigned = useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await fetch(`/api/threads/${threadId}/tags`);
      const json = await res.json().catch(() => ({}));
      if (res.ok) setAssignedTags(json.tags ?? []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [threadId]);

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/tags");
      const json = await res.json().catch(() => ({}));
      if (res.ok) setAvailableTags((json.tags ?? []).filter((t) => t.is_active));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    setAssignedTags([]);
    fetchAssigned();
  }, [fetchAssigned, threadId, refreshTrigger]);

  useEffect(() => { fetchAvailable(); }, [fetchAvailable]);

  // Luk dropdown ved klik udenfor
  useEffect(() => {
    if (!dropdownOpen) return;
    const handle = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [dropdownOpen]);

  const handleAdd = useCallback(async (tag) => {
    if (adding) return;
    setDropdownOpen(false);
    setAdding(tag.id);
    try {
      const res = await fetch(`/api/threads/${threadId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setAssignedTags((prev) => {
          const exists = prev.some((t) => t.id === json.tag.id);
          return exists ? prev : [...prev, json.tag];
        });
      }
    } catch { /* silent */ } finally {
      setAdding(null);
    }
  }, [adding, threadId]);

  const handleRemove = useCallback(async (tag) => {
    if (removing) return;
    setRemoving(tag.id);
    try {
      await fetch(`/api/threads/${threadId}/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      setAssignedTags((prev) => prev.filter((t) => t.id !== tag.id));
    } catch { /* silent */ } finally {
      setRemoving(null);
    }
  }, [removing, threadId]);

  const assignedIds = new Set(assignedTags.map((t) => t.id));
  const unassigned = availableTags.filter((t) => !assignedIds.has(t.id));

  if (loading && assignedTags.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap px-4 py-2 border-b border-gray-100 bg-white min-h-[36px]">
      {assignedTags.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          onRemove={removing === tag.id ? null : handleRemove}
        />
      ))}

      {/* + knap for at tilføje tag */}
      {unassigned.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-slate-400 border border-dashed border-slate-200 hover:border-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Tilføj tag"
          >
            <Plus className="w-3 h-3" />
            Tag
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px] max-h-64 overflow-y-auto">
              {unassigned.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => handleAdd(tag)}
                  disabled={adding === tag.id}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
