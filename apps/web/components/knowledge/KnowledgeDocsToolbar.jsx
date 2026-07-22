"use client";

import {
  Bold,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SECTION_HEADING_LEVEL,
  SECTION_HEADING_TOOLTIP,
} from "@/lib/knowledge/knowledge-doc-editor-config";

function ToolbarButton({ active, disabled, label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100",
        active && "border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

export function KnowledgeDocsToolbar({ editor }) {
  const disabled = !editor;

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href || "";
    const url = window.prompt("Link URL", previousUrl);
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/60">
      <ToolbarButton
        label="Bold"
        icon={Bold}
        disabled={disabled}
        active={editor?.isActive("bold")}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        icon={Italic}
        disabled={disabled}
        active={editor?.isActive("italic")}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label={SECTION_HEADING_TOOLTIP}
        icon={Heading2}
        disabled={disabled}
        active={editor?.isActive("heading", { level: SECTION_HEADING_LEVEL })}
        onClick={() => editor?.chain().focus().toggleHeading({ level: SECTION_HEADING_LEVEL }).run()}
      />
      <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-800" />
      <ToolbarButton
        label="Bullet list"
        icon={List}
        disabled={disabled}
        active={editor?.isActive("bulletList")}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Ordered list"
        icon={ListOrdered}
        disabled={disabled}
        active={editor?.isActive("orderedList")}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Link"
        icon={Link}
        disabled={disabled}
        active={editor?.isActive("link")}
        onClick={setLink}
      />
    </div>
  );
}
