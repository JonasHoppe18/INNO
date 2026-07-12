"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Fragment, Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  SECTION_HEADING_LEVEL,
  SECTION_HEADING_TOOLTIP,
} from "@/lib/knowledge/knowledge-doc-editor-config";
import { parseKnowledgeDocumentMarkdownPaste } from "@/lib/knowledge/knowledge-doc-markdown-paste";
import { normalizeKnowledgeDocumentMarkdown } from "@/lib/knowledge/knowledge-doc-markdown-roundtrip";

const extensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
    },
    link: {
      openOnClick: false,
      autolink: true,
    },
  }),
  Markdown,
];

function ToolbarButton({ active, disabled, label, icon: Icon, onClick }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="size-8 text-muted-foreground transition-transform duration-150 active:scale-[0.97]"
    >
      <Icon />
    </Button>
  );
}

export function KnowledgeDocsEditor({ value, onChange }) {
  const editor = useEditor({
    extensions,
    content: value || "",
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "mx-auto min-h-[560px] w-full max-w-5xl px-8 py-9 outline-none md:px-12",
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") || "";
        const pastedContent = parseKnowledgeDocumentMarkdownPaste(text);
        if (!pastedContent) return false;

        event.preventDefault();
        const nodes = pastedContent.map((node) => view.state.schema.nodeFromJSON(node));
        const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
    onUpdate({ editor }) {
      onChange?.(normalizeKnowledgeDocumentMarkdown(editor.getMarkdown()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = String(value || "");
    if (normalizeKnowledgeDocumentMarkdown(editor.getMarkdown()) === next) return;
    editor.commands.setContent(next, {
      contentType: "markdown",
      emitUpdate: false,
    });
  }, [editor, value]);

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
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-4 py-2">
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
        <Separator orientation="vertical" className="mx-1 h-5" />
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
      <EditorContent
        editor={editor}
        className={cn(
          "prose prose-sm max-w-none dark:prose-invert",
          "[&_.ProseMirror_h1]:mb-5 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-semibold",
          "[&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-9 [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-semibold",
          "[&_.ProseMirror_h3]:mb-2 [&_.ProseMirror_h3]:mt-5 [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold",
          "[&_.ProseMirror_p]:my-3 [&_.ProseMirror_p]:leading-7",
          "[&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6",
          "[&_.ProseMirror_ol]:my-3 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6",
          "[&_.ProseMirror_li]:my-1 [&_.ProseMirror_li>p]:my-1",
          "[&_.ProseMirror_a]:text-primary [&_.ProseMirror_a]:underline",
          "[&_.ProseMirror]:text-[14px] [&_.ProseMirror]:text-foreground",
        )}
      />
    </div>
  );
}
