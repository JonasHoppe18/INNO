"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SnippetList({ snippets, selectedId, onSelect, newDraft }) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? snippets.filter((s) =>
        s.title.toLowerCase().includes(search.trim().toLowerCase())
      )
    : snippets;

  return (
    <div className="flex h-full flex-col">
      <div className="mx-2 mb-1 mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-300" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search snippets..."
          className="flex-1 bg-transparent text-[11px] text-gray-700 placeholder:text-gray-400 outline-none"
        />
      </div>
      <div className="flex-1 overflow-y-auto space-y-0.5 px-2 pb-2 pt-0.5">
        {newDraft && (
          <div
            onClick={() => onSelect(null)}
            className="cursor-pointer rounded-md border border-dashed border-indigo-300 bg-indigo-50 px-2 py-1.5"
          >
            <div className="text-[11.5px] font-semibold text-indigo-600">
              New snippet
            </div>
          </div>
        )}
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
  const visibleTags = [...productTags.slice(0, 2), ...issueTags.slice(0, 2)];

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md px-2 py-1.5 transition-colors duration-100",
        active ? "bg-indigo-50" : "hover:bg-gray-50"
      )}
    >
      <div
        className={cn(
          "truncate text-[11.5px] font-medium",
          active ? "font-semibold text-indigo-700" : "text-gray-700"
        )}
      >
        {snippet.title}
      </div>
      {visibleTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {visibleTags.map((tag) => (
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
    </div>
  );
}
