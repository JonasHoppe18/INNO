"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SnippetList({ snippets, selectedId, onSelect }) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? snippets.filter((s) =>
        s.title.toLowerCase().includes(search.trim().toLowerCase())
      )
    : snippets;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-300" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search snippets..."
          className="flex-1 bg-transparent text-[11px] text-gray-600 placeholder:text-gray-300 outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filtered.map((snippet) => (
          <SnippetRow
            key={snippet.snippet_id}
            snippet={snippet}
            active={selectedId === snippet.snippet_id}
            onClick={() => onSelect(snippet.snippet_id)}
          />
        ))}
      </div>
    </div>
  );
}

function SnippetRow({ snippet, active, onClick }) {
  const productTags = Array.isArray(snippet.products) ? snippet.products : [];
  const issueTags = Array.isArray(snippet.issue_types) ? snippet.issue_types : [];
  const topTags = [...productTags.slice(0, 1), ...issueTags.slice(0, 2)];
  const isQa = snippet.format === "qa";
  // For Q&A snippets show the answer as the preview — the question is already
  // implicit from the title (which users often set to the question itself).
  const previewSource = isQa && snippet.answer
    ? snippet.answer
    : snippet.content || "";
  const preview = previewSource.trim().replace(/\s+/g, " ").slice(0, 80);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors duration-150 hover:bg-gray-50/80",
        active && "bg-gray-100/60"
      )}
    >
      {/* Left accent bar */}
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] rounded-r transition-colors duration-150",
          active ? "bg-indigo-400" : "bg-transparent"
        )}
      />

      {/* Title with Q&A indicator */}
      <span
        className={cn(
          "flex items-center gap-1.5 truncate text-[12.5px] font-medium leading-snug",
          active ? "text-indigo-700" : "text-gray-800"
        )}
      >
        {isQa && (
          <span className="shrink-0 rounded-sm bg-indigo-50 px-1 text-[9px] font-semibold uppercase tracking-wide text-indigo-500">
            Q&amp;A
          </span>
        )}
        <span className="truncate">{snippet.title}</span>
      </span>

      {/* Content preview */}
      {preview && (
        <span className="truncate text-[11px] leading-snug text-gray-400">
          {preview}
        </span>
      )}

      {/* Tags */}
      {topTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {topTags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px]",
                productTags.includes(tag)
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
