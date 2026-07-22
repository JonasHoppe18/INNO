"use client";

import { EditorContent } from "@tiptap/react";
import { cn } from "@/lib/utils";

export function KnowledgeDocsCanvas({ editor }) {
  return (
    <EditorContent
      editor={editor}
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        "[&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold",
        "[&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-7 [&_.ProseMirror_h2]:border-b [&_.ProseMirror_h2]:pb-2 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:[scroll-margin-top:var(--knowledge-doc-header-height,7rem)] dark:[&_.ProseMirror_h2]:border-gray-800",
        "[&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-5 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold",
        "[&_.ProseMirror_p]:my-3 [&_.ProseMirror_p]:leading-7",
        "[&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
        "[&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
        "[&_.ProseMirror_li]:my-1 [&_.ProseMirror_li>p]:my-1",
        "[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline dark:[&_.ProseMirror_a]:text-indigo-400",
        "[&_.ProseMirror]:text-[14px] [&_.ProseMirror]:text-gray-800 dark:[&_.ProseMirror]:text-gray-100",
      )}
    />
  );
}
